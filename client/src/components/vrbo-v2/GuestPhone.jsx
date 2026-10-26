import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import chatScript from "../../data/vrbo-v2/chatScript.json";
import copy from "../../data/vrbo-v2/copy.json";
import users from "../../data/vrbo-v2/users.json";
import { assembleGuestParts, partsToText, sharedPhraseBank } from "@shared/vrboChatCopy.js";
import { createMessageMotionController } from "./chatMotion.js";
import { preloadVrboPhoneImages } from "../../lib/preloadVrboHotelImages.js";
import PreferenceCard from "./PreferenceCard.jsx";
import { playVrboSound } from "./vrboSound.js";
import PropertyCard from "./PropertyCard.jsx";
import RichChatText from "./RichChatText.jsx";
import useTailFitMessages from "./useTailFitMessages.js";

const PHONE_AVATAR_FILLS = { jamie: "#fff1c3", sarah: "#d6f5e8", alex: "#dbf0fa", chris: "#f2f2db" };

const guests = users.filter((user) => user.role === "guest");

const PHONE_WIDTH = 393;
const PHONE_HEIGHT = 851.126;

/** Fixed Figma previews; native phone pages fit width and use available height. */
function ScaledPhoneCanvas({ children }) {
  const viewportRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, left: 0, top: 0, height: PHONE_HEIGHT });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const resize = () => {
      const { width, height } = viewport.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const native = Boolean(viewport.closest('.vrbo-v2-device--phone:not(.is-framed)'));
      const scale = native ? width / PHONE_WIDTH : Math.min(width / PHONE_WIDTH, height / PHONE_HEIGHT);
      const canvasHeight = native ? height / scale : PHONE_HEIGHT;
      const next = {
        scale,
        left: (width - PHONE_WIDTH * scale) / 2,
        top: (height - canvasHeight * scale) / 2,
        height: canvasHeight,
      };
      setFit((previous) =>
        previous.scale === next.scale && previous.left === next.left && previous.top === next.top && previous.height === next.height
          ? previous
          : next,
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="vrbo-v2-phone__viewport" ref={viewportRef} aria-label="393×851.126 phone canvas">
      <div
        className="vrbo-v2-phone__surface"
        style={{ width: PHONE_WIDTH, height: fit.height, left: fit.left, top: fit.top, transform: `scale(${fit.scale})`, "--phone-canvas-h": fit.height, "--phone-scale": fit.scale }}
      >
        {children}
      </div>
    </div>
  );
}

function fill(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}

function resolveUser(user, displayNames = {}) {
  if (!user) return user;
  const custom = displayNames[user.id];
  if (custom == null || custom === "") return user;
  return { ...user, name: custom };
}

function PhoneAvatar({ user, className = "vrbo-v2-phone__avatar" }) {
  if (user?.avatar) {
    return (
      <span className={`${className} has-photo`} style={{ "--phone-avatar-fill": PHONE_AVATAR_FILLS[user.id] || user.accent }} aria-hidden="true">
        <img src={user.avatar} alt="" />
      </span>
    );
  }
  return (
    <span
      className={className}
      style={{ background: user.accent, color: user.onAccent }}
      aria-hidden="true"
    >
      {user.initials}
    </span>
  );
}

function WaitingPills({ guestList, joinedMap, displayNames }) {
  return (
    <div className="vrbo-v2-phone__waiting" aria-label="Guests joining">
      {guestList.map((guest, index) => {
        const joined = Boolean(joinedMap[guest.id]);
        const named = resolveUser(guest, displayNames);
        const label = joined ? named.name : copy.phone.joinWaiting;
        return (
          <span
            key={guest.id}
            className={`vrbo-v2-phone__waiting-pill${joined ? " is-joined" : ""}`}
            style={{ "--join-i": index }}
            aria-label={label}
          >
            {/* Handoff: keep both layers mounted; animate Waiting → avatar+name. */}
            <span className="vrbo-v2-phone__waiting-slot vrbo-v2-phone__waiting-slot--idle">
              <span className="vrbo-v2-phone__waiting-dot" aria-hidden="true" />
              <span className="vrbo-v2-phone__waiting-label">
                Waiting
                <span className="vrbo-v2-phone__waiting-breathe" aria-hidden="true">
                  <i>.</i>
                  <i>.</i>
                  <i>.</i>
                </span>
              </span>
            </span>
            <span className="vrbo-v2-phone__waiting-slot vrbo-v2-phone__waiting-slot--joined">
              <PhoneAvatar
                user={named}
                className="vrbo-v2-phone__waiting-avatar"
              />
              <span className="vrbo-v2-phone__waiting-name">{named.name}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Same pill row as join Waiting… — used for joined members in chat phases. */
function MemberPills({ members, selfId }) {
  if (!members.length) return null;
  const ordered = [...members].sort((a, b) => {
    if (a.id === selfId) return -1;
    if (b.id === selfId) return 1;
    return 0;
  });
  return (
    <div className="vrbo-v2-phone__waiting" aria-label="People in this trip">
      {ordered.map((member) => {
        const isYou = member.id === selfId;
        return (
          <span
            key={member.id}
            className={`vrbo-v2-phone__waiting-pill vrbo-v2-phone__waiting-pill--solid is-joined${
              isYou ? " is-you" : ""
            }`}
          >
            <PhoneAvatar user={member} className="vrbo-v2-phone__waiting-avatar" />
            {member.name}
          </span>
        );
      })}
    </div>
  );
}

/** Shared blue header + pill row (tuned on join) — same on every phone phase. */
function PhoneHeader({ subtitle, children = null }) {
  return (
    <header className="vrbo-v2-phone__join-head">
      <div className="vrbo-v2-phone__join-head-row">
        <span className="vrbo-v2-phone__group-avatar" aria-hidden="true">
          <img src="/images/Vrbo-Images/group-avatar.png" alt="" />
        </span>
        <div>
          <h3>{chatScript.groupTitle}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </header>
  );
}

function authorLabel(user, { isSelf = false } = {}) {
  if (isSelf) return user.name;
  if (user.role === "coordinator") {
    return `${user.name} · ${user.roleLabel || copy.chat.groupPlannerLabel || "Primary planner"}`;
  }
  return user.name;
}

function PhoneBubble({
  user,
  text,
  parts,
  isSelf = false,
  sharedIds,
  phraseBank,
}) {
  return (
    <div className={`vrbo-v2-phone__msg${isSelf ? " is-self" : ""}`}>
      {!isSelf ? <PhoneAvatar user={user} /> : null}
      <div className={`vrbo-v2-phone__bubble${isSelf ? " is-self" : ""}`}>
        <p className="vrbo-v2-phone__bubble-author">{authorLabel(user, { isSelf })}</p>
        <RichChatText
          className="vrbo-v2-phone__bubble-text"
          text={text}
          parts={parts}
          sharedIds={sharedIds}
          phraseBank={phraseBank}
        />
      </div>
      {isSelf ? <PhoneAvatar user={user} /> : null}
    </div>
  );
}

function MessageFeed({
  messages,
  typing,
  userById,
  propertyLookup,
  live = false,
  selfId,
  afterMessages = null,
  sharedIds,
  phraseBank,
  lockOverflow = false,
}) {
  const feedRef = useRef(null);
  const motionRef = useRef(null);
  if (motionRef.current == null) {
    motionRef.current = createMessageMotionController();
  }
  const phaseMessages = live
    ? messages ?? []
    : (messages ?? []).filter((message) => message.kind !== "property").slice(-6);
  // Finale keeps Jamie's "I found the perfect place…" line, same as Display 1.
  const baseMessages = phaseMessages;
  const lockFeed =
    lockOverflow || baseMessages.some((message) => message.phase === "finale");
  const visibleMessages = useTailFitMessages(baseMessages, feedRef, lockFeed);
  const showTyping = Boolean(typing?.length && !lockFeed);

  const motionKey = visibleMessages
    .map((message) => `${message.id}:${message.exiting ? 1 : 0}`)
    .join("|");

  useLayoutEffect(() => {
    motionRef.current.sync(feedRef.current, visibleMessages, "phone", {
      typing: showTyping,
    });
  }, [motionKey, visibleMessages, showTyping]);

  return (
    <div
      className={`vrbo-v2-phone__feed${live ? " is-live" : ""}${
        lockFeed ? " is-feed-locked" : ""
      }`}
      ref={feedRef}
    >
      {visibleMessages.map((message) => {
        const author = userById[message.authorId];
        if (!author) return null;
        const isSelf = Boolean(selfId && author.id === selfId);
        const entry = propertyLookup?.(message.propertyId);
        const exitClass = message.exiting ? " is-exit" : "";
        if (message.kind === "property" && entry) {
          return (
            <div
              key={message.id}
              data-msg-id={message.id}
              data-tail-fit-row=""
              className={`vrbo-v2-phone__property${isSelf ? " is-self" : ""}${exitClass}`}
            >
              <div className={`vrbo-v2-phone__msg${isSelf ? " is-self" : ""}`}>
                {!isSelf ? <PhoneAvatar user={author} /> : null}
                <p className={`vrbo-v2-phone__bubble-author${isSelf ? " is-self" : ""}`}>
                  {authorLabel(author, { isSelf })}
                </p>
                {isSelf ? <PhoneAvatar user={author} /> : null}
              </div>
              <PropertyCard property={entry.property} title={entry.cardTitle} variant="chat" />
            </div>
          );
        }
        return (
          <div
            key={message.id}
            data-msg-id={message.id}
            data-tail-fit-row=""
            className={`vrbo-v2-phone__msg-wrap${isSelf ? " is-self" : ""}${exitClass}`}
          >
            <PhoneBubble
              user={author}
              text={message.text}
              parts={message.parts}
              isSelf={isSelf}
              sharedIds={sharedIds}
              phraseBank={phraseBank}
            />
          </div>
        );
      })}
      {showTyping ? (
        <p data-msg-typing="" className="vrbo-v2-phone__typing">
          {copy.phone.idleSubtitle}
        </p>
      ) : null}
      {afterMessages}
    </div>
  );
}

function ReadonlyComposer() {
  return (
    <div className="vrbo-v2-phone__composer is-readonly">
      <div className="vrbo-v2-phone__composer-row">
        <span className="vrbo-v2-phone__composer-add" aria-hidden="true">
          +
        </span>
        <div className="vrbo-v2-phone__composer-field">
          <span>{copy.phone.watchPlaceholder}</span>
          <button
            type="button"
            className="vrbo-v2-phone__composer-send"
            disabled
            aria-label={copy.phone.watchPlaceholder}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GuestPhone({
  user,
  preferences,
  preferenceById,
  selection,
  submitted,
  joined,
  joinedMap = {},
  displayNames = {},
  canJoin,
  stage,
  messages,
  typing,
  userById,
  propertyLookup,
  selectedPropertyId = null,
  celebrating = false,
  sharedPriorityIds = [],
  onJoin,
  onToggle,
  onSubmit,
  bare = false,
  runId = 0,
}) {
  const [draftName, setDraftName] = useState("");

  // Chip images are large; fetch + decode them as soon as the phone opens (not on first tap).
  useEffect(() => {
    preloadVrboPhoneImages();
  }, []);

  useEffect(() => {
    setDraftName("");
  }, [runId, user.id]);

  // Restart / leave clears join — drop any leftover typed name.
  useEffect(() => {
    if (!joined) setDraftName("");
  }, [joined]);

  const max = copy.maxSelections;
  const groupFinished =
    stage === "summary" || stage === "searching" || stage === "results";
  // After join → select chips immediately (never flash the idle message feed).
  const phase = !joined
    ? canJoin
      ? "join"
      : "closed"
    : submitted || groupFinished
      ? "watch"
      : "select";
  const atLimit = selection.length >= max;
  const canSend = selection.length === max;
  const draftParts = assembleGuestParts(user.id, selection, preferences, copy);
  const draftText = partsToText(draftParts);
  const sharedIds = useMemo(
    () => new Set(sharedPriorityIds ?? []),
    [sharedPriorityIds],
  );
  const phraseBank = useMemo(
    () => (sharedIds.size ? sharedPhraseBank([...sharedIds], preferences, copy) : []),
    [sharedIds, preferences],
  );

  const namedUserById = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(userById || {}).map(([id, person]) => [id, resolveUser(person, displayNames)]),
      ),
    [userById, displayNames],
  );
  const chipMembers = Object.values(namedUserById).filter(
    (member) => member.role === "guest" && Boolean(joinedMap[member.id]),
  );
  const showMemberChips = phase === "select" || phase === "watch";

  const handleContinue = () => {
    onJoin(user.id, draftName.trim());
  };

  const waitingForGuests = phase === "join" || phase === "closed";
  const planner = namedUserById.jamie;
  const headerSubtitle = `${planner?.name || "Jamie"} · ${planner?.roleLabel || "Primary planner"} · ${waitingForGuests ? guests.length : chipMembers.length} guests ${waitingForGuests ? "joining" : "joined"}`;

  const screen = (
        <div className={`vrbo-v2-phone__screen${selectedPropertyId ? " is-finale" : ""}`}>
          <div className="vrbo-v2-phone__chrome">
            <span className="vrbo-v2-phone__time">9:41</span>
            <span className="vrbo-v2-phone__notch" aria-hidden="true" />
          </div>

          <PhoneHeader subtitle={headerSubtitle}>
            {phase === "join" || phase === "closed" ? (
              <WaitingPills
                guestList={guests}
                joinedMap={joinedMap}
                displayNames={displayNames}
              />
            ) : showMemberChips ? (
              <MemberPills members={chipMembers} selfId={user.id} />
            ) : null}
          </PhoneHeader>

          {phase === "join" || phase === "closed" ? (
            <div
              key="join"
              className="vrbo-v2-phone__panel vrbo-v2-phone__panel--join vrbo-v2-phone__panel--enter"
            >
              <div className="vrbo-v2-phone__join">
                <div className="vrbo-v2-phone__join-avatar-wrap">
                  <PhoneAvatar user={user} className="vrbo-v2-phone__join-avatar" />
                  <span className="vrbo-v2-phone__join-avatar-label">{copy.phone.joinAvatarLabel}</span>
                </div>
                <h4>{copy.phone.joinTitle}</h4>
                <p>{phase === "closed" ? copy.phone.joinClosed : copy.phone.joinBody}</p>
                {phase === "join" ? (
                  <>
                    <label className="vrbo-v2-phone__join-field">
                      <span className="visually-hidden">{user.name}</span>
                      <input
                        type="text"
                        value={draftName}
                        placeholder={copy.phone.joinPlaceholder}
                        autoComplete="nickname"
                        maxLength={24}
                        onChange={(event) => setDraftName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleContinue();
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="vrbo-v2-btn vrbo-v2-phone__join-cta"
                      onClick={handleContinue}
                    >
                      {copy.phone.joinCta}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {phase === "select" ? (
            <div
              key="select"
              className="vrbo-v2-phone__panel vrbo-v2-phone__panel--select"
            >
              <div className="vrbo-v2-phone__prompt">
                <p
                  className="vrbo-v2-phone__prompt-title is-stage-enter"
                  style={{
                    "--stage-delay": "450ms",
                    "--stage-duration": "650ms",
                    "--stage-y": "16px",
                  }}
                >
                  {copy.phone.promptTitle}
                </p>
                <div className="vrbo-v2-phone__chips">
                  {preferences.map((preference, index) => {
                    const selected = selection.includes(preference.id);
                    return (
                        <PreferenceCard
                          key={preference.id}
                          preference={{ ...preference, image: `/images/Vrbo-Images/mobile/preferences/${preference.id}.webp` }}
                          variant="chip"
                          selected={selected}
                          disabled={!selected && atLimit}
                          onSelect={() => {
                            playVrboSound("tapAmenity");
                            onToggle(user.id, preference.id);
                          }}
                          enterIndex={index}
                        />
                    );
                  })}
                </div>
                <p
                  className="vrbo-v2-phone__selected-hint is-stage-enter"
                  style={{
                    "--stage-delay": "1000ms",
                    "--stage-duration": "560ms",
                    "--stage-y": "12px",
                  }}
                >
                  {fill(copy.phone.selectedReview, {
                    count: selection.length,
                    max,
                  })}
                </p>
              </div>

              <div
                className={`vrbo-v2-phone__composer is-stage-enter ${
                  draftText ? "has-draft" : ""
                }`}
                style={{
                  "--stage-delay": "1120ms",
                  "--stage-duration": "650ms",
                  "--stage-y": "18px",
                }}
              >
                <div className="vrbo-v2-phone__composer-row">
                  <div
                    className={`vrbo-v2-phone__composer-field ${
                      draftText ? "is-filled" : ""
                    }`}
                  >
                    {draftText ? (
                      <p className="vrbo-v2-phone__draft-line">
                        {draftText}
                      </p>
                    ) : (
                      <span>{copy.phone.composerPlaceholder}</span>
                    )}
                    <button
                      type="button"
                      className="vrbo-v2-phone__composer-send"
                      disabled={!canSend}
                      aria-label={canSend ? copy.phone.submit : copy.phone.submitLocked}
                      onClick={() => onSubmit(user.id)}
                    >
                      ↑
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {phase === "watch" ? (
            <div
              key="watch"
              className="vrbo-v2-phone__panel vrbo-v2-phone__panel--chat vrbo-v2-phone__panel--enter"
            >
              <MessageFeed
                messages={messages}
                typing={typing}
                userById={namedUserById}
                propertyLookup={propertyLookup}
                selfId={user.id}
                live
                sharedIds={sharedIds}
                phraseBank={phraseBank}
                lockOverflow={Boolean(celebrating || selectedPropertyId)}
                afterMessages={
                  selectedPropertyId ? null : (
                    <p className="vrbo-v2-phone__continue">{copy.phone.continueCta}</p>
                  )
                }
              />
              <ReadonlyComposer />
            </div>
          ) : null}
        </div>
  );

  if (bare) {
    return <div className="vrbo-v2-phone vrbo-v2-phone--bare"><ScaledPhoneCanvas>{screen}</ScaledPhoneCanvas></div>;
  }

  return (
    <div className="vrbo-v2-phone">
      <div className="vrbo-v2-phone__frame"><ScaledPhoneCanvas>{screen}</ScaledPhoneCanvas></div>
      <p className="vrbo-v2-phone__label">
        <span>{user.phoneLabel}</span>
      </p>
    </div>
  );
}

