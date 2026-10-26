import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import chatScript from "../../data/vrbo-v2/chatScript.json";
import copy from "../../data/vrbo-v2/copy.json";
import preferences from "../../data/vrbo-v2/preferences.json";
import { sharedPhraseBank } from "@shared/vrboChatCopy.js";
import { createMessageMotionController } from "./chatMotion.js";
import PropertyCard from "./PropertyCard.jsx";
import RichChatText from "./RichChatText.jsx";
import useTailFitMessages from "./useTailFitMessages.js";
import { playSharedVrboSound } from "./vrboSound.js";

const JOIN_TOAST_MS = 2800;
const CHAT_AVATAR_FILLS = {
  jamie: "#fff1c3",
  sarah: "#d6f5e8",
  alex: "#dbf0fa",
  chris: "#f2f2db",
};

function fill(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}

function Avatar({ user, className = "vrbo-v2-chat__avatar" }) {
  if (user?.avatar) {
    return (
      <span
        className={`${className} has-photo`}
        style={{ "--chat-avatar-fill": CHAT_AVATAR_FILLS[user.id] || user.accent }}
        aria-hidden="true"
      >
        <img src={user.avatar} alt="" />
      </span>
    );
  }
  return (
    <span className={className} style={{ background: user.accent, color: user.onAccent }}>
      {user.initials}
    </span>
  );
}

export default function MainChatScreen({
  messages,
  typing,
  userById,
  propertyLookup,
  celebrating,
  joined = {},
  submitted = {},
  displayNames = {},
  sharedPriorityIds = [],
  runId = 0,
  hearSounds = false,
}) {
  const feedRef = useRef(null);
  const motionRef = useRef(null);
  const seenJoinedRef = useRef(null);
  const heardMessagesRef = useRef(null);
  const heardRunRef = useRef(runId);
  const joinToastTimerRef = useRef(0);
  const [joinToast, setJoinToast] = useState(null);
  const motionRunIdRef = useRef(runId);
  if (motionRef.current == null || motionRunIdRef.current !== runId) {
    motionRunIdRef.current = runId;
    motionRef.current = createMessageMotionController();
  }

  const lockFeed =
    Boolean(celebrating) ||
    (messages ?? []).some((message) => message.phase === "finale");
  const displayMessages = useTailFitMessages(messages, feedRef, lockFeed);

  const namedUserById = Object.fromEntries(
    Object.entries(userById).map(([id, user]) => {
      const custom = displayNames[id];
      return [id, custom ? { ...user, name: custom } : user];
    }),
  );

  useEffect(() => {
    if (!hearSounds) return;

    const list = (messages ?? []).filter((message) => !message.exiting);
    if (heardMessagesRef.current == null || heardRunRef.current !== runId) {
      heardRunRef.current = runId;
      heardMessagesRef.current = new Set(list.map((message) => message.id));
      return;
    }

    const seen = heardMessagesRef.current;
    const fresh = list.filter((message) => message.id && !seen.has(message.id));
    fresh.forEach((message) => seen.add(message.id));

    // Only the shared property card makes a sound. Text messages are silent.
    fresh.forEach((message) => {
      if (message.kind === "property") playSharedVrboSound("propertyText");
    });
  }, [messages, runId, hearSounds]);

  useEffect(() => {
    if (!hearSounds) return undefined;
    const activeIds = Object.keys(joined).filter((id) => Boolean(joined[id]));
    if (seenJoinedRef.current == null) {
      seenJoinedRef.current = new Set(activeIds);
      return undefined;
    }

    const newcomers = activeIds.filter((id) => !seenJoinedRef.current.has(id));
    newcomers.forEach((id) => seenJoinedRef.current.add(id));

    // Drop ids that left (restart) so a re-join can toast again.
    [...seenJoinedRef.current].forEach((id) => {
      if (!activeIds.includes(id)) seenJoinedRef.current.delete(id);
    });

    if (!newcomers.length) return undefined;

    const id = newcomers[newcomers.length - 1];
    const custom = displayNames[id];
    const name = custom || userById[id]?.name || "Someone";
    const template = copy.chat.joinedToast || "{name} joined the chat.";
    setJoinToast({ id: `${id}-${Date.now()}`, text: fill(template, { name }) });

    window.clearTimeout(joinToastTimerRef.current);
    joinToastTimerRef.current = window.setTimeout(() => {
      setJoinToast(null);
    }, JOIN_TOAST_MS);

    return () => window.clearTimeout(joinToastTimerRef.current);
  }, [joined, displayNames, userById, hearSounds]);
  const members = Object.values(namedUserById).filter(
    (user) => user.role === "coordinator" || Boolean(joined[user.id]),
  );
  const typingUsers = typing.map((id) => namedUserById[id]).filter(Boolean);
  const guestUsers = Object.values(namedUserById).filter((user) => user.role === "guest");
  const guestTotal = guestUsers.length;
  const guestsJoined = guestUsers.filter((user) => Boolean(joined[user.id])).length;
  const guestsWaiting = Math.max(0, guestTotal - guestsJoined);
  const anyoneSubmitted = Object.values(submitted).some(Boolean);
  const showPickupFooter = guestsWaiting > 0 && !anyoneSubmitted;
  // After Jamie's intro, before anyone submits: stacked guest avatars + "..."
  const hasJamieIntro = (messages ?? []).some(
    (message) =>
      message.phase === "intro" ||
      (message.authorId === "jamie" &&
        message.kind !== "property" &&
        !message.preferenceIds?.length &&
        message.phase !== "finale" &&
        message.phase !== "planner"),
  );
  const hasPreferenceOrFinale = (messages ?? []).some(
    (message) =>
      message.phase === "preference" ||
      message.phase === "finale" ||
      message.kind === "property",
  );
  const showIdleTyping =
    hasJamieIntro && !hasPreferenceOrFinale && !anyoneSubmitted && !celebrating;
  const idleTypingUsers = guestUsers.slice(0, 2);
  const typingRowUsers = typingUsers.length ? typingUsers : showIdleTyping ? idleTypingUsers : [];
  const plannerLabel = copy.chat.groupPlannerLabel || "Primary planner";
  const sharedIds = useMemo(() => new Set(sharedPriorityIds ?? []), [sharedPriorityIds]);
  const phraseBank = useMemo(
    () => (sharedIds.size ? sharedPhraseBank([...sharedIds], preferences, copy) : []),
    [sharedIds],
  );
  // No guests yet → waiting copy; each join appends: Jamie, Sarah, Alex…
  const peopleLine =
    guestsJoined === 0
      ? copy.chat.waitingGuests
      : members.map((user) => user.name).join(", ");
  // "Waiting for guests to join" + the same breathing "..." as Waiting on the phones.
  const waitingLabel = String(copy.chat.waitingGuests ?? "").replace(/[….]+\s*$/, "");

  function authorLabel(user) {
    if (user.role === "coordinator") {
      return `${user.name} · ${user.roleLabel || plannerLabel}`;
    }
    return user.name;
  }

  const motionKey = displayMessages
    .map((message) => `${message.id}:${message.exiting ? 1 : 0}`)
    .join("|");

  useLayoutEffect(() => {
    motionRef.current.sync(feedRef.current, displayMessages, "chat", {
      typing: typingRowUsers.length > 0,
    });
  }, [motionKey, displayMessages, typingRowUsers.length]);

  return (
    <div
      className={`vrbo-v2-chat${celebrating ? " is-celebrating" : ""}${
        lockFeed ? " is-feed-locked" : ""
      }`}
    >
      <header className="vrbo-v2-chat__masthead">
        <img
          className="vrbo-v2-chat__brand is-opening-enter"
          src="/logo/Vrbo_Logo_Sail_RGB.png"
          alt="Vrbo"
        />
        <h2 className="vrbo-v2-chat__trip is-opening-title">{chatScript.groupTitle}</h2>
        <p className={`vrbo-v2-chat__people is-opening-status${guestsJoined > 0 ? " is-joined" : ""}`}>
          {guestsJoined === 0 ? (
            <>
              {waitingLabel}
              <span className="vrbo-v2-chat__breathe" role="presentation" aria-hidden="true">
                <i>.</i>
                <i>.</i>
                <i>.</i>
              </span>
            </>
          ) : (
            peopleLine
          )}
        </p>
      </header>

      <div className={`vrbo-v2-chat__body${showPickupFooter ? "" : " is-footer-empty"}`}>
        {joinToast ? (
          <p key={joinToast.id} className="vrbo-v2-chat__join-toast" role="status">
            {joinToast.text}
          </p>
        ) : null}
        <div className="vrbo-v2-chat__feed" ref={feedRef}>
          {displayMessages.map((message) => {
            const user = namedUserById[message.authorId];
            if (!user) return null;
            const entry = propertyLookup?.(message.propertyId);

            return (
              <div
                key={message.id}
                data-msg-id={message.id}
                data-tail-fit-row=""
                className={`vrbo-v2-chat__row vrbo-v2-chat__row--${user.role}${
                  message.kind === "property" ? " vrbo-v2-chat__row--card" : ""
                }${message.exiting ? " is-exit" : ""}`}
              >
                {message.kind === "property" && entry ? (
                  <div className="vrbo-v2-chat__card">
                    <PropertyCard property={entry.property} title={entry.cardTitle} variant="chat" />
                  </div>
                ) : (
                  <>
                    <Avatar user={user} />
                    <div className="vrbo-v2-chat__bubble">
                      <span className="vrbo-v2-chat__author">{authorLabel(user)}</span>
                      <RichChatText
                        className="vrbo-v2-chat__text"
                        text={message.text}
                        parts={message.parts}
                        sharedIds={sharedIds}
                        phraseBank={phraseBank}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {typingRowUsers.length ? (
            <div key="typing" data-msg-typing="" className="vrbo-v2-chat__typing">
              <div className="vrbo-v2-chat__typing-avatars" aria-hidden="true">
                {typingRowUsers.slice(0, 3).map((user) => (
                  <Avatar key={user.id} user={user} className="vrbo-v2-chat__typing-avatar" />
                ))}
              </div>
              <p className="vrbo-v2-chat__bubble vrbo-v2-chat__bubble--typing" aria-hidden="true">
                <i />
                <i />
                <i />
              </p>
            </div>
          ) : null}
        </div>

        <div className={`vrbo-v2-chat__footer${showPickupFooter ? "" : " is-empty"}`}>
          {showPickupFooter ? (
            <p className="vrbo-v2-chat__footer-text is-pickup-hop">
              Pick up a phone
              <br />
              and join the conversation
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
