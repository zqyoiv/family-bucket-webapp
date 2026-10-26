import { useEffect, useRef, useState } from "react";
import chatScript from "../../data/vrbo-v2/chatScript.json";
import copy from "../../data/vrbo-v2/copy.json";
import properties from "../../data/vrbo-v2/properties.json";
import users from "../../data/vrbo-v2/users.json";
import OpeningLoop from "./OpeningLoop.jsx";
import { StayShowcase } from "./StayViews.jsx";
import { playSharedVrboSound, playTapSearchSound } from "./vrboSound.js";

const FINALE_BG_SRC = "/images/Vrbo-Images/final-bg.jpg";

const propertyById = new Map(properties.map((property) => [property.id, property]));

const SUMMARY_TEXT_START_MS = 1010;
const SUMMARY_TEXT_DURATION_MS = 2000;
const SUMMARY_WORD_FADE_MS = 180;

function useSummaryTypingComplete(text) {
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const full = text ?? "";
    setComplete(false);
    if (!full) {
      return undefined;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    if (reduceMotion) {
      setComplete(true);
      return undefined;
    }

    // Search follows the final word's fade, rather than the first paint.
    const timer = window.setTimeout(() => setComplete(true),
      SUMMARY_TEXT_START_MS + SUMMARY_TEXT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  return complete;
}

/** True `delayMs` after `value` becomes true; false again as soon as `value` is false. */
function useDelayedTrue(value, delayMs) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!value) {
      setOn(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setOn(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return on;
}

/** Pause after Jamie's message lands before "Pulling it all together…" appears. */
const PULLING_DELAY_MS = chatScript.preference?.pullingDelayMs ?? 500;

function WaitingPanel({
  ready,
  soft = false,
  title = copy.ranking.loadingTitle,
  subtitle = copy.ranking.loadingSubtitle,
}) {
  // `soft`: keep the same blue the opening loop sits on and fade only the text in, slowly.
  const enterClass = soft ? "is-soft" : "vrbo-v2-rank__panel--enter";
  return (
    <div
      className={`vrbo-v2-rank__panel vrbo-v2-rank__panel--hero ${
        ready ? `is-loading ${enterClass}` : "is-opening"
      }`}
    >
      {ready ? (
        <div className="vrbo-v2-rank__hero-loading">
          <span className="vrbo-v2-rank__spinner" aria-hidden="true" />
          <h2>{title}</h2>
          <p className="vrbo-v2-rank__lede">{subtitle}</p>
        </div>
      ) : (
        <OpeningLoop />
      )}
    </div>
  );
}

export function SummaryPanel({
  summaryText,
  onSearch,
  compact = false,
}) {
  const complete = useSummaryTypingComplete(summaryText);
  const words = String(summaryText ?? "").match(/\S+\s*/g) ?? [];
  const wordStep = (SUMMARY_TEXT_DURATION_MS - SUMMARY_WORD_FADE_MS) / Math.max(1, words.length - 1);

  return (
    <div className={`vrbo-v2-summary ${compact ? "vrbo-v2-summary--compact" : ""}`}>
      <header className="vrbo-v2-summary__masthead">
        <img
          className="vrbo-v2-summary__brand is-scene-enter"
          src="/logo/Vrbo_Logo_Sail_RGB.png"
          alt={copy.summary.brand}
          style={{ "--scene-delay": "0ms", "--scene-y": "17px", "--scene-duration": "750ms" }}
        />
      </header>

      <div className="vrbo-v2-summary__body">
        <h2
          className="vrbo-v2-summary__title is-scene-enter"
          style={{ "--scene-delay": "80ms", "--scene-y": "28px", "--scene-duration": "750ms" }}
        >
          {copy.summary.title}
        </h2>

        <div
          className="vrbo-v2-summary__box is-scene-enter"
          role="textbox"
          aria-readonly="true"
          aria-label={summaryText}
          style={{ "--scene-delay": "160ms", "--scene-y": "28px", "--scene-duration": "750ms" }}
        >
          <p className="vrbo-v2-summary__box-label">{copy.summary.boxLabel}</p>
          <p
            className="vrbo-v2-summary__box-text"
            aria-hidden={Boolean(summaryText)}
          >
            {words.map((word, index) => (
              <span
                key={`${summaryText}-${index}`}
                className="vrbo-v2-summary__word"
                style={{ animationDelay: `${SUMMARY_TEXT_START_MS + index * wordStep}ms`, animationDuration: `${SUMMARY_WORD_FADE_MS}ms` }}
              >{word}</span>
            ))}
          </p>
        </div>

        <div className="vrbo-v2-summary__spacer" aria-hidden="true" />

        <button
          type="button"
          className={`vrbo-v2-summary__search${complete ? " is-scene-enter" : ""}`}
          style={{ visibility: complete ? "visible" : "hidden", "--scene-delay": "0ms", "--scene-y": "20px", "--scene-duration": "650ms" }}
          disabled={!complete}
          onClick={() => {
            playTapSearchSound();
            onSearch?.();
          }}
        >
          {copy.summary.search}
        </button>
      </div>
    </div>
  );
}

function ResultsPanel({
  results,
  priorities,
  previewPropertyId,
  selectedPropertyId,
  actions,
}) {
  return (
    <div className="vrbo-v2-rank__panel vrbo-v2-rank__panel--light vrbo-v2-rank__panel--showcase">
      <StayShowcase
        results={results}
        priorities={priorities}
        previewPropertyId={previewPropertyId}
        selectedPropertyId={selectedPropertyId}
        onPreview={actions.previewProperty}
        onShare={actions.selectProperty}
      />
    </div>
  );
}

function resolveSelectedProperty(selectedPropertyId, results = []) {
  if (selectedPropertyId == null) return null;
  const fromResults = results.find((entry) => entry.property?.id === selectedPropertyId);
  if (fromResults?.property) return fromResults.property;
  return propertyById.get(selectedPropertyId) ?? null;
}

function buildChatParticipantNames(joined = {}, displayNames = {}) {
  // Jamie + guests who actually joined (custom nicknames when set).
  const names = users
    .filter(
      (user) => user.role === "coordinator" || Boolean(joined[user.id]),
    )
    .map((user) => displayNames[user.id] || user.name);
  return names.length ? names.join(", ") : chatScript.groupSubtitle;
}

function FinaleLockedPanel({
  selectedPropertyId,
  results = [],
  joined = {},
  displayNames = {},
}) {
  const property = resolveSelectedProperty(selectedPropertyId, results);
  const namesLine = buildChatParticipantNames(joined, displayNames);
  const title = chatScript.groupTitle;
  const hotelAlt = property?.name ? `${property.name}` : title;

  return (
    <div
      className="vrbo-v2-rank__finale"
      aria-label={`${title} locked in`}
      style={{ "--finale-bg": `url("${FINALE_BG_SRC}")` }}
    >
      <div className="vrbo-v2-rank__finale-stage">
        <div className="vrbo-v2-rank__finale-card">
          {property?.image ? (
            <img
              className="vrbo-v2-rank__finale-hotel"
              src={property.image}
              alt={hotelAlt}
              draggable={false}
            />
          ) : (
            <div
              className="vrbo-v2-rank__finale-hotel vrbo-v2-rank__finale-hotel--fallback"
              style={property?.gradient ? { background: property.gradient } : undefined}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="vrbo-v2-rank__finale-copy">
          <h2 className="vrbo-v2-rank__finale-title">{title}</h2>
          <p className="vrbo-v2-rank__finale-names">{namesLine}</p>
        </div>
      </div>
    </div>
  );
}

export default function RankingScreen({
  stage,
  summaryText,
  results,
  priorities,
  allSubmitted,
  plannerReady = true,
  previewPropertyId,
  selectedPropertyId,
  celebrating = false,
  joined = {},
  displayNames = {},
  actions,
  hearSounds = false,
}) {
  const stageReadyRef = useRef(false);
  const pullingReady = useDelayedTrue(allSubmitted && plannerReady, PULLING_DELAY_MS);

  useEffect(() => {
    if (!hearSounds) return;
    if (!stageReadyRef.current) {
      stageReadyRef.current = true;
      return;
    }
    // The results (property) page is intentionally silent.
    if (stage === "summary" || stage === "searching") {
      playSharedVrboSound("textAppear");
    }
  }, [stage, hearSounds]);

  if (celebrating) {
    return (
      <div className="vrbo-v2-rank vrbo-v2-rank--finale">
        <FinaleLockedPanel
          selectedPropertyId={selectedPropertyId}
          results={results}
          joined={joined}
          displayNames={displayNames}
        />
      </div>
    );
  }

  return (
    <div className="vrbo-v2-rank">
      {stage === "intro" || stage === "selecting" ? (
        // Opening loop until everyone submitted AND Jamie's SMS is out, then "Pulling it all together…".
        <WaitingPanel
          key={pullingReady ? "loading" : "waiting"}
          ready={pullingReady}
          soft
        />
      ) : null}

      {stage === "summary" ? (
        <SummaryPanel
          key="summary"
          summaryText={summaryText}
          onSearch={actions.searchStays}
        />
      ) : null}

      {stage === "searching" ? (
        <WaitingPanel
          key="search-loading"
          ready
          soft
          title={copy.ranking.searchLoadingTitle || copy.ranking.loadingTitle}
          subtitle={
            copy.ranking.searchLoadingSubtitle || copy.ranking.loadingSubtitle
          }
        />
      ) : null}

      {stage === "results" ? (
        <ResultsPanel
          key="results"
          results={results}
          priorities={priorities}
          previewPropertyId={previewPropertyId}
          selectedPropertyId={selectedPropertyId}
          actions={actions}
        />
      ) : null}
    </div>
  );
}

