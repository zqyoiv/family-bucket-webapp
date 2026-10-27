import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CANVAS_H, CANVAS_W } from "../canvas.js";
import GuestPhone from "../components/vrbo-v2/GuestPhone.jsx";
import HyperionLogPanel from "../components/vrbo-v2/HyperionLogPanel.jsx";
import MainChatScreen from "../components/vrbo-v2/MainChatScreen.jsx";
import RankingScreen from "../components/vrbo-v2/RankingScreen.jsx";
import copy from "../data/vrbo-v2/copy.json";
import preferences from "../data/vrbo-v2/preferences.json";
import properties from "../data/vrbo-v2/properties.json";
import users from "../data/vrbo-v2/users.json";
import { VRBO_UI } from "../config/vrboUi.js";
import useLandscapeGate from "../hooks/useLandscapeGate.js";
import useVrboHyperionDevice, { VGC_PHONE_BY_GUEST } from "../hooks/useVrboHyperionDevice.js";
import useVrboIphoneWebApp from "../hooks/useVrboIphoneWebApp.js";
import useVrboSessionStartOnActivity from "../hooks/useVrboSessionStartOnActivity.js";
import useVrboV2Session, { guests } from "../hooks/useVrboV2Session.js";
import { buildStayCardTitle } from "@shared/vrboStayCopy.js";

const VRBO_IPHONE_WEBAPP = {
  sarah: { routeKey: "ip1", title: "Interactive Experience" },
  alex: { routeKey: "ip2", title: "Interactive Experience" },
  chris: { routeKey: "ip3", title: "Interactive Experience" },
};

/**
 * Portrait 4K canvas (2160×3840 = rotated 3840×2160 panel).
 * Outer frame fluid-fits the container (same idea as iPhone 15 frame);
 * inner UI stays fixed pixels and scales with transform.
 */
function ScaledDisplayCanvas({ className = "", children }) {
  const frameRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;

    const fit = () => {
      const width = node.clientWidth || 1;
      const height = node.clientHeight || 1;
      setScale(Math.min(width / CANVAS_W, height / CANVAS_H));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <div
      ref={frameRef}
      className={`vrbo-v2-displayHd ${className}`.trim()}
      aria-label={`${CANVAS_W}×${CANVAS_H}`}
    >
      <div
        className="vrbo-v2-displayHd__panel"
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const userById = Object.fromEntries(users.map((user) => [user.id, user]));
const preferenceById = new Map(preferences.map((preference) => [preference.id, preference]));
const propertyById = new Map(properties.map((property) => [property.id, property]));

function usePropertyLookup(results, priorities) {
  return useMemo(() => {
    const byId = new Map((results ?? []).map((result) => [result.property.id, result]));
    return (propertyId) => {
      if (propertyId == null) return null;
      const scored = byId.get(propertyId);
      const entry = scored ?? (propertyById.has(propertyId)
        ? { property: propertyById.get(propertyId), matched: [] }
        : null);
      if (!entry) return null;
      // Server results can lag the client JSON (loaded once at boot) — client fields fill gaps.
      const property = { ...(propertyById.get(propertyId) ?? {}), ...entry.property };
      return {
        ...entry,
        property,
        cardTitle: buildStayCardTitle(property, priorities, copy),
      };
    };
  }, [results, priorities]);
}

function VrboLandscapeGate() {
  return (
    <div className="vrbo-v2-stage vrbo-v2-stage--gate">
      <div className="vrbo-v2-gate" role="status" aria-live="polite">
        <p className="vrbo-v2-stage__eyebrow">{copy.stage.eyebrow}</p>
        <div className="vrbo-v2-gate__icon" aria-hidden="true">
          <span className="vrbo-v2-gate__phone" />
          <span className="vrbo-v2-gate__arrow">↻</span>
        </div>
        <h1>{copy.stage.landscapeTitle}</h1>
        <p className="vrbo-v2-gate__body">{copy.stage.landscapeBody}</p>
      </div>
    </div>
  );
}

function CursorHighlight({ enabled }) {
  const [pos, setPos] = useState({ x: -999, y: -999 });

  useEffect(() => {
    if (!enabled) return undefined;
    function onMove(event) {
      setPos({ x: event.clientX, y: event.clientY });
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      className="vrbo-v2-cursor-glow"
      aria-hidden="true"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
    />
  );
}

function RestartControl({ onReset }) {
  return (
    <div className="vrbo-v2-stage__controls">
      <button type="button" className="vrbo-v2-stage__restart" onClick={onReset}>
        {copy.stage.restart}
      </button>
    </div>
  );
}

/** Jamie's "here's what you all want" SMS — Display 2 shows "Pulling it all together" after it. */
function hasPlannerMessage(messages) {
  return (messages ?? []).some((message) => message.phase === "planner");
}

function VrboDemo() {
  const { state, allSubmitted, actions, hearSounds } = useVrboV2Session();
  const {
    stage,
    messages,
    typing,
    joined,
    selections,
    submitted,
    summaryText,
    results,
    priorities,
    previewPropertyId,
    selectedPropertyId,
    celebrating,
    displayNames = {},
    runId = 0,
  } = state;
  const [cursorHighlight, setCursorHighlight] = useState(false);
  const [phonesOnly, setPhonesOnly] = useState(false);
  const propertyLookup = usePropertyLookup(results, priorities);
  // Demo stage includes interactive + phones — any activity starts VGC session.
  useVrboSessionStartOnActivity(actions.startSession);

  const renderPhone = (user) => (
    <GuestPhone
      key={`${user.id}-${runId}`}
      user={user}
      preferences={preferences}
      preferenceById={preferenceById}
      selection={selections[user.id] ?? []}
      submitted={submitted[user.id]}
      joined={Boolean(joined[user.id])}
      joinedMap={joined}
      displayNames={displayNames}
      canJoin={stage === "intro" || stage === "selecting"}
      stage={stage}
      groupReady={allSubmitted}
      messages={messages}
      typing={typing}
      userById={userById}
      propertyLookup={propertyLookup}
      selectedPropertyId={selectedPropertyId}
      celebrating={celebrating}
      sharedPriorityIds={state.sharedPriorityIds}
      onJoin={actions.joinGuest}
      onToggle={actions.togglePreference}
      onSubmit={actions.submitGuest}
      runId={runId}
    />
  );

  return (
    <div
      className={`vrbo-v2-stage ${cursorHighlight ? "has-cursor-highlight" : ""} ${
        phonesOnly ? "is-phones-only" : ""
      }`}
    >
      <CursorHighlight enabled={cursorHighlight} />

      <div className="vrbo-v2-stage__controls">
        <button type="button" className="vrbo-v2-stage__restart" onClick={actions.reset}>
          {copy.stage.restart}
        </button>
        <label className="vrbo-v2-stage__toggle">
          <input
            type="checkbox"
            checked={cursorHighlight}
            onChange={(event) => setCursorHighlight(event.target.checked)}
          />
          <span>{copy.stage.cursorHighlight}</span>
        </label>
        <label className="vrbo-v2-stage__toggle">
          <input
            type="checkbox"
            checked={phonesOnly}
            onChange={(event) => setPhonesOnly(event.target.checked)}
          />
          <span>{copy.stage.phonesOnly}</span>
        </label>
      </div>

      <div className="vrbo-v2-stage__board">
        {!phonesOnly ? (
          <div className="vrbo-v2-stage__left">
            <section className="vrbo-v2-display vrbo-v2-display--chat">
              <p className="vrbo-v2-display__label">{copy.screenLabels.chat}</p>
              <div className="vrbo-v2-display__body">
                <MainChatScreen
                  messages={messages}
                  typing={typing}
                  userById={userById}
                  propertyLookup={propertyLookup}
                  celebrating={celebrating}
                  joined={joined}
                  submitted={submitted}
                  displayNames={displayNames}
                  sharedPriorityIds={state.sharedPriorityIds}
                  runId={runId}
                  hearSounds={hearSounds}
                />
              </div>
            </section>

            <section className="vrbo-v2-display vrbo-v2-display--rank">
              <p className="vrbo-v2-display__label">{copy.screenLabels.ranking}</p>
              <div className="vrbo-v2-display__body">
                <RankingScreen
                  key={runId}
                  stage={stage}
                  summaryText={summaryText}
                  results={results}
                  priorities={priorities}
                  allSubmitted={allSubmitted}
                  plannerReady={hasPlannerMessage(messages)}
                  previewPropertyId={previewPropertyId}
                  selectedPropertyId={selectedPropertyId}
                  celebrating={celebrating}
                  joined={joined}
                  displayNames={displayNames}
                  actions={actions}
                  hearSounds={hearSounds}
                />
              </div>
            </section>
          </div>
        ) : null}

        <div className="vrbo-v2-stage__right">
          {phonesOnly ? (
            <div className="vrbo-v2-stage__phones-row">{guests.map(renderPhone)}</div>
          ) : (
            <>
              <div className="vrbo-v2-stage__phones-top">
                {guests.slice(0, 2).map(renderPhone)}
              </div>
              <div className="vrbo-v2-stage__phones-bottom">
                {guests.slice(2).map(renderPhone)}
                <HyperionLogPanel />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const VRBO_LEFT_REF = "/images/Vrbo-Images/example/vrbo-l";
const VRBO_LEFT_REFS = {
  intro: { src: `${VRBO_LEFT_REF}/1-intro.png`, caption: "Reference · intro" },
  firstSms: { src: `${VRBO_LEFT_REF}/2-sarah.png`, caption: "Reference · first SMS" },
  allPriority: {
    src: `${VRBO_LEFT_REF}/3-all-priority.png`,
    caption: "Reference · all priorities",
  },
  share: {
    src: `${VRBO_LEFT_REF}/4-share-property.png`,
    caption: "Reference · shared stay",
  },
};
const VRBO_IPHONE_REFS = {
  join: "/images/Vrbo-Images/example/vrbo-iphone/avatar.png",
  chat: "/images/Vrbo-Images/example/vrbo-iphone/2.png",
  submitted: "/images/Vrbo-Images/example/vrbo-iphone/3.png",
  hotel: "/images/Vrbo-Images/example/vrbo-iphone/4.png",
};
const VRBO_RIGHT_REFS = {
  waiting: "/images/Vrbo-Images/example/vrbo-r/1.png",
  summary: "/images/Vrbo-Images/example/vrbo-r/2.png",
  stay: "/images/Vrbo-Images/example/vrbo-r/3.png",
  locked: "/images/Vrbo-Images/example/vrbo-r/4.png",
};

function vrboLeftReference(state) {
  if (state.celebrating || state.selectedPropertyId) {
    return VRBO_LEFT_REFS.share;
  }

  const submittedCount = guests.filter((guest) => Boolean(state.submitted?.[guest.id])).length;
  const joinedGuests = guests.filter((guest) => Boolean(state.joined?.[guest.id]));
  const allSubmitted =
    joinedGuests.length >= 2 &&
    joinedGuests.every((guest) => Boolean(state.submitted?.[guest.id]));
  const laterStage =
    state.stage === "summary" ||
    state.stage === "searching" ||
    state.stage === "results";

  if (allSubmitted || laterStage || submittedCount >= 3) {
    return VRBO_LEFT_REFS.allPriority;
  }
  if (submittedCount >= 1) {
    return VRBO_LEFT_REFS.firstSms;
  }
  return VRBO_LEFT_REFS.intro;
}

function vrboRightReference(stage, { celebrating = false, selectedPropertyId = null } = {}) {
  if (celebrating || selectedPropertyId) {
    return { src: VRBO_RIGHT_REFS.locked, caption: "Reference · locked in" };
  }
  if (stage === "summary") {
    return { src: VRBO_RIGHT_REFS.summary, caption: "Reference · summary" };
  }
  if (stage === "searching") {
    return { src: VRBO_RIGHT_REFS.waiting, caption: "Reference · searching" };
  }
  if (stage === "results") {
    return { src: VRBO_RIGHT_REFS.stay, caption: "Reference · stay" };
  }
  return { src: VRBO_RIGHT_REFS.waiting, caption: "Reference · waiting" };
}

/** Display 1 · Organizer chat. Prod = full-bleed; `compareLayout` = live + reference. */
export function VrboLeftPage({ compareLayout = false } = {}) {
  const { state, actions, hearSounds } = useVrboV2Session({ syncOnly: true });
  const propertyLookup = usePropertyLookup(state.results, state.priorities);
  useVrboSessionStartOnActivity(actions.startSession);
  useVrboHyperionDevice("organizer");

  const reference = vrboLeftReference(state);
  const live = (
    <ScaledDisplayCanvas>
      <MainChatScreen
        messages={state.messages}
        typing={state.typing}
        userById={userById}
        propertyLookup={propertyLookup}
        celebrating={state.celebrating}
        joined={state.joined}
        submitted={state.submitted ?? {}}
        displayNames={state.displayNames ?? {}}
        sharedPriorityIds={state.sharedPriorityIds}
        runId={state.runId}
        hearSounds={hearSounds}
      />
    </ScaledDisplayCanvas>
  );

  if (!compareLayout) {
    return (
      <div className="vrbo-v2-device vrbo-v2-device--display">
        <RestartControl onReset={actions.reset} />
        <div className="vrbo-v2-device__stage vrbo-v2-device__stage--display-live">{live}</div>
      </div>
    );
  }

  return (
    <div className="vrbo-v2-device vrbo-v2-device--display">
      <RestartControl onReset={actions.reset} />
      <div className="vrbo-v2-device__stage vrbo-v2-device__stage--display-compare">
        <div className="vrbo-v2-displayFrame">
          {live}
          <p className="vrbo-v2-displayFrame__caption">Live · chat</p>
        </div>
        <div className="vrbo-v2-displayFrame">
          <div
            className="vrbo-v2-displayHd vrbo-v2-displayHd--reference"
            aria-label={`${CANVAS_W}×${CANVAS_H} reference`}
          >
            <img
              className="vrbo-v2-displayHd__reference"
              src={reference.src}
              alt="Vrbo left design reference"
              draggable={false}
            />
          </div>
          <p className="vrbo-v2-displayFrame__caption">{reference.caption}</p>
        </div>
      </div>
    </div>
  );
}

/** Display 2 · Output / search. Prod = full-bleed; `compareLayout` = live + reference. */
export function VrboRightPage({ compareLayout = false } = {}) {
  const { state, allSubmitted, actions, hearSounds } = useVrboV2Session({ syncOnly: true });
  useVrboHyperionDevice("output");
  const reference = vrboRightReference(state.stage, {
    celebrating: state.celebrating,
    selectedPropertyId: state.selectedPropertyId,
  });
  const live = (
    <ScaledDisplayCanvas>
      {/* key=runId: every restart remounts Display 2 so the opening loop starts from frame 1. */}
      <RankingScreen
        key={state.runId ?? 0}
        stage={state.stage}
        summaryText={state.summaryText}
        results={state.results}
        priorities={state.priorities}
        allSubmitted={allSubmitted}
        plannerReady={hasPlannerMessage(state.messages)}
        previewPropertyId={state.previewPropertyId}
        selectedPropertyId={state.selectedPropertyId}
        celebrating={state.celebrating}
        joined={state.joined}
        displayNames={state.displayNames ?? {}}
        actions={actions}
        hearSounds={hearSounds}
      />
    </ScaledDisplayCanvas>
  );

  if (!compareLayout) {
    return (
      <div className="vrbo-v2-device vrbo-v2-device--display">
        <div className="vrbo-v2-device__stage vrbo-v2-device__stage--display-live">{live}</div>
      </div>
    );
  }

  return (
    <div className="vrbo-v2-device vrbo-v2-device--display">
      <div className="vrbo-v2-device__stage vrbo-v2-device__stage--display-compare">
        <div className="vrbo-v2-displayFrame">
          {live}
          <p className="vrbo-v2-displayFrame__caption">
            {state.celebrating ? "Finale · locked in" : "Live · search"}
          </p>
        </div>
        <div className="vrbo-v2-displayFrame">
          <div
            className="vrbo-v2-displayHd vrbo-v2-displayHd--reference"
            aria-label={`${CANVAS_W}×${CANVAS_H} reference`}
          >
            <img
              className="vrbo-v2-displayHd__reference"
              src={reference.src}
              alt="Vrbo right design reference"
              draggable={false}
            />
          </div>
          <p className="vrbo-v2-displayFrame__caption">{reference.caption}</p>
        </div>
      </div>
    </div>
  );
}

/** Guest phone page — prod full bleed; `compareLayout` = live + reference. */
export function GuestPhonePage({ guestId, compareLayout = false } = {}) {
  const [params, setParams] = useSearchParams();
  const frameParam = params.get("frame") ?? params.get("iphone");
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true);
  const compare = compareLayout || VRBO_UI.compareLayout;
  // Compare / iPhone chrome only when debug compare is on (never in standalone).
  const framed =
    compare &&
    !standalone &&
    (frameParam === "1" || (guestId === "sarah" && frameParam !== "0"));
  const webApp = VRBO_IPHONE_WEBAPP[guestId];
  useVrboIphoneWebApp(webApp ?? {});
  useVrboHyperionDevice(VGC_PHONE_BY_GUEST[guestId] ?? null);
  const { state, actions } = useVrboV2Session({ syncOnly: true });
  const {
    stage,
    messages,
    typing,
    joined,
    selections,
    submitted,
    results,
    displayNames = {},
    runId = 0,
    selectedPropertyId = null,
    celebrating = false,
  } = state;
  const guest = guests.find((user) => user.id === guestId);
  const propertyLookup = usePropertyLookup(results, state.priorities);
  useVrboSessionStartOnActivity(actions.startSession);

  if (!guest) return null;

  const phone = (
    <GuestPhone
      key={`${guest.id}-${runId}`}
      user={guest}
      preferences={preferences}
      preferenceById={preferenceById}
      selection={selections[guest.id] ?? []}
      submitted={submitted[guest.id]}
      joined={Boolean(joined[guest.id])}
      joinedMap={joined}
      displayNames={displayNames}
      canJoin={stage === "intro" || stage === "selecting"}
      stage={stage}
      messages={messages}
      typing={typing}
      userById={userById}
      propertyLookup={propertyLookup}
      selectedPropertyId={selectedPropertyId}
      celebrating={celebrating}
      sharedPriorityIds={state.sharedPriorityIds}
      onJoin={actions.joinGuest}
      onToggle={actions.togglePreference}
      onSubmit={actions.submitGuest}
      bare
      runId={runId}
    />
  );

  const toggleFrame = () => {
    const next = new URLSearchParams(params);
    next.delete("iphone");
    if (framed) {
      if (guestId === "sarah") next.set("frame", "0");
      else {
        next.delete("frame");
      }
    } else {
      next.set("frame", "1");
    }
    setParams(next, { replace: true });
  };

  const showReference = framed && guestId === "sarah";
  const iphoneReference =
    celebrating || selectedPropertyId
      ? { src: VRBO_IPHONE_REFS.hotel, caption: "Reference · hotel" }
      : Boolean(submitted[guest.id]) ||
        stage === "summary" ||
        stage === "searching" ||
        stage === "results"
        ? { src: VRBO_IPHONE_REFS.submitted, caption: "Reference · submitted" }
        : Boolean(joined[guest.id])
          ? { src: VRBO_IPHONE_REFS.chat, caption: "Reference · chat" }
          : { src: VRBO_IPHONE_REFS.join, caption: "Reference · join" };

  return (
    <div
      className={`vrbo-v2-device vrbo-v2-device--phone${framed ? " is-framed" : ""}${standalone ? " is-standalone" : ""}`}
    >
      {!framed ? <div className="vrbo-v2-statusbar-cap" aria-hidden="true" /> : null}
      {compare && !standalone ? (
        <button
          type="button"
          className="vrbo-v2-device__frame-toggle"
          onClick={toggleFrame}
          aria-pressed={framed}
        >
          {framed ? "Full screen" : "iPhone 15 frame"}
        </button>
      ) : null}

      {framed ? (
        <div
          className={`vrbo-v2-device__stage${showReference ? " vrbo-v2-device__stage--compare" : ""}`}
        >
          <div className="vrbo-v2-iphone15" aria-label="iPhone 15 preview">
            <div className="vrbo-v2-iphone15__bezel">
              <div className="vrbo-v2-iphone15__screen">{phone}</div>
            </div>
            <p className="vrbo-v2-iphone15__caption">Sarah · iPhone 15</p>
          </div>

          {showReference ? (
            <div className="vrbo-v2-iphone15" aria-label="Reference UI">
              <div className="vrbo-v2-iphone15__bezel vrbo-v2-iphone15__bezel--reference">
                <img
                  className="vrbo-v2-iphone15__reference"
                  src={iphoneReference.src}
                  alt="Reference UI"
                  draggable={false}
                />
              </div>
              <p className="vrbo-v2-iphone15__caption">{iphoneReference.caption}</p>
            </div>
          ) : null}
        </div>
      ) : (
        phone
      )}
    </div>
  );
}

/** @deprecated use GuestPhonePage({ guestId: "sarah" }) */
export function SarahPhonePage() {
  return <GuestPhonePage guestId="sarah" />;
}

export default function VrboV2Screen() {
  const landscapeReady = useLandscapeGate();
  if (!landscapeReady) return <VrboLandscapeGate />;
  return <VrboDemo />;
}
