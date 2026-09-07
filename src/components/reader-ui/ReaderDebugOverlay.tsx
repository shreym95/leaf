"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReaderDebugSnapshot, ReaderDebugTurn } from "@/reader/engine";

/**
 * ReaderDebugOverlay — the on-device readout for DEFECTS.md D2 ("the last page
 * of a chapter is skipped on mobile"). TEMPORARY diagnostic chrome: it exists so
 * the founder can capture real numbers from a real phone, which the desktop
 * harness could not reproduce.
 *
 * GATED. Rendered only when the reader URL carries `?debug=1` (see
 * `./debug-flag`). This is a live production app; a normal reader must never see
 * it, and with the flag off the engine does not even build the probe.
 *
 * PRESENTATION ONLY. Every number comes from `controller.debugSnapshot()` in the
 * style-agnostic reader layer (`@/reader/debug`) — this file just paints it, in
 * design tokens, and hands it to the clipboard.
 */

export interface ReaderDebugOverlayProps {
  /** Pull the current snapshot; null until the engine has attached. */
  snapshot: () => ReaderDebugSnapshot | null;
  /** Subscribe to engine pushes. Returns an unsubscribe fn, or null if the
   *  engine isn't ready yet — the overlay retries. */
  subscribe: (cb: () => void) => (() => void) | null;
}

/** Backstop poll. The engine pushes on every relocation, turn, resize and late
 *  image load; this only covers the gap before it has attached. */
const POLL_MS = 1000;

interface DeviceInfo {
  win: string;
  visual: string;
  dpr: number;
  ua: string;
}

function readDevice(): DeviceInfo | null {
  if (typeof window === "undefined") return null;
  const vv = window.visualViewport;
  return {
    win: `${window.innerWidth}x${window.innerHeight}`,
    visual: vv
      ? `${Math.round(vv.width)}x${Math.round(vv.height)} @${Math.round(vv.offsetTop)}`
      : "n/a",
    dpr: window.devicePixelRatio,
    ua: window.navigator.userAgent,
  };
}

/** Compact number: integers stay integers, fractions keep 2dp (the fractional
 *  part is the whole point of half these fields). */
function n(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function pos(t: { section: number | null; page: number | null; total: number | null }): string {
  return `s${t.section ?? "—"} ${t.page ?? "—"}/${t.total ?? "—"}`;
}

function turnLine(t: ReaderDebugTurn): string {
  const after = t.after ? pos(t.after) : "no-move";
  return (
    `#${t.n} ${t.source} ${pos(t.before)} -> ${after}` +
    ` [sl ${n(t.before.scrollLeft)} ow ${n(t.before.offsetWidth)}` +
    ` sw ${n(t.before.scrollWidth)} d ${n(t.before.delta)}` +
    ` adv ${t.before.canAdvance === null ? "—" : t.before.canAdvance ? "yes" : "NO"}]` +
    (t.skipped ? "  << SKIPPED" : "")
  );
}

/**
 * The whole readout as plain text, for the clipboard. Exported so the format is
 * testable and so a change here can't silently diverge from what's on screen.
 */
export function formatDebugText(
  snap: ReaderDebugSnapshot | null,
  device: DeviceInfo | null,
): string {
  if (!snap) return "leaf debug — engine not attached yet";
  const c = snap.container;
  const l = snap.layout;
  const v = snap.view;
  const i = snap.images;
  const lines = [
    "leaf reader debug (DEFECTS.md D2)",
    `time      ${new Date().toISOString()}`,
    device ? `device    win ${device.win} · visual ${device.visual} · dpr ${device.dpr}` : "",
    device ? `ua        ${device.ua}` : "",
    "",
    `section   ${snap.section ?? "—"}  ${snap.href ?? ""}`,
    `page      ${snap.page ?? "—"} / ${snap.total ?? "—"}   spread ${snap.spread}`,
    `container scrollLeft ${n(c?.scrollLeft)} · offsetWidth ${n(c?.offsetWidth)} · scrollWidth ${n(c?.scrollWidth)} · clientWidth ${n(c?.clientWidth)} · offsetHeight ${n(c?.offsetHeight)}`,
    `layout    delta ${n(l?.delta)} · pageWidth ${n(l?.pageWidth)} · columnWidth ${n(l?.columnWidth)} · gap ${n(l?.gap)} · height ${n(l?.height)} · width ${n(l?.width)} · divisor ${n(l?.divisor)}`,
    `box       ${n(snap.measuredBox?.width)} x ${n(snap.measuredBox?.height)}  (what relayout passes to rendition.resize)`,
    `view      iframe ${n(v?.iframeWidth)}x${n(v?.iframeHeight)} · element ${n(v?.elementWidth)} · view.width ${n(v?.reportedWidth)} · doc.scrollWidth ${n(v?.bodyScrollWidth)}`,
    `advance   ${n(c?.scrollLeft)} + ${n(c?.offsetWidth)} + ${n(l?.delta)} = ${n(snap.advanceLeft)} <= ${n(c?.scrollWidth)} -> ${snap.canAdvance === null ? "—" : snap.canAdvance ? "TURN PAGE" : "NEXT SECTION"}`,
    `images    ${i.total} total · ${i.complete} complete · ${i.loadedAfterLayout} loaded after layout${i.lastLateMs != null ? ` (last +${Math.round(i.lastLateMs)}ms)` : ""}`,
    `          scrollWidth at layout ${n(i.scrollWidthAtLayout)} -> after images ${n(i.scrollWidthAfterImages)}`,
    `cfi       ${snap.cfi ?? "—"}`,
    "",
    `turns (newest first, ${snap.turns.length})`,
    ...(snap.turns.length ? snap.turns.map((t) => `  ${turnLine(t)}`) : ["  (none yet)"]),
  ];
  return lines.filter((line) => line !== "").join("\n");
}

const LABEL =
  "shrink-0 text-faint [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-label)] uppercase";
const VALUE = "text-ink [font-size:var(--leaf-text-3xs)] [word-break:break-word]";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 leading-snug">
      <span className={`${LABEL} w-[4.5rem]`}>{label}</span>
      <span className={VALUE}>{children}</span>
    </div>
  );
}

export function ReaderDebugOverlay({ snapshot, subscribe }: ReaderDebugOverlayProps) {
  const [open, setOpen] = useState(true);
  const [snap, setSnap] = useState<ReaderDebugSnapshot | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "ok" | "manual">("idle");

  // Engine pushes drive the readout; the interval only bridges the gap before
  // the controller exists (and re-reads the viewport, which fires no event of
  // its own on some mobile browsers).
  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | null = null;

    const pull = () => {
      if (!alive) return;
      setSnap(snapshot());
      setDevice(readDevice());
    };

    const attach = () => {
      if (unsub) return;
      unsub = subscribe(pull);
    };

    attach();
    pull();
    const id = setInterval(() => {
      attach();
      pull();
    }, POLL_MS);

    return () => {
      alive = false;
      clearInterval(id);
      unsub?.();
    };
  }, [snapshot, subscribe]);

  const text = useMemo(() => formatDebugText(snap, device), [snap, device]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("ok");
      setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      // Clipboard blocked (permission, or a non-secure context) — fall back to
      // showing the text so it can be selected by hand.
      setCopyState("manual");
    }
  }, [text]);

  const c = snap?.container;
  const l = snap?.layout;
  const v = snap?.view;
  const img = snap?.images;

  const panelChrome = {
    background: "var(--leaf-page)",
    borderColor: "var(--leaf-rule)",
    fontFamily: "var(--leaf-font-mono)",
  } as const;

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Show reader debug readout"
        onClick={() => setOpen(true)}
        className="fixed left-2 z-50 rounded-sm border px-2 py-1 text-ink [font-size:var(--leaf-text-3xs)] [letter-spacing:var(--leaf-tracking-label)] uppercase"
        style={{
          ...panelChrome,
          bottom: `calc(var(--leaf-space-2) + var(--leaf-safe-bottom))`,
        }}
      >
        dbg
      </button>
    );
  }

  return (
    <section
      aria-label="Reader debug readout"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[52dvh] flex-col border-t"
      style={{
        ...panelChrome,
        paddingLeft: `calc(var(--leaf-space-2) + var(--leaf-safe-left))`,
        paddingRight: `calc(var(--leaf-space-2) + var(--leaf-safe-right))`,
        paddingBottom: `calc(var(--leaf-space-2) + var(--leaf-safe-bottom))`,
        paddingTop: "var(--leaf-space-2)",
      }}
    >
      <header className="flex shrink-0 items-center gap-2 pb-1">
        <span className={LABEL}>leaf debug · D2</span>
        <span className="grow" />
        <button
          type="button"
          onClick={copy}
          className="rounded-sm border px-2 py-1 text-ink [font-size:var(--leaf-text-3xs)] uppercase [letter-spacing:var(--leaf-tracking-label)]"
          style={{ borderColor: "var(--leaf-rule)" }}
        >
          {copyState === "ok" ? "copied" : "copy"}
        </button>
        <button
          type="button"
          aria-label="Hide reader debug readout"
          onClick={() => setOpen(false)}
          className="rounded-sm border px-2 py-1 text-ink [font-size:var(--leaf-text-3xs)] uppercase [letter-spacing:var(--leaf-tracking-label)]"
          style={{ borderColor: "var(--leaf-rule)" }}
        >
          hide
        </button>
      </header>

      <div className="min-h-0 grow overflow-y-auto overscroll-contain">
        {!snap ? (
          <p className={VALUE}>waiting for the engine…</p>
        ) : (
          <>
            <Row label="section">
              {snap.section ?? "—"} <span className="text-faint">{snap.href ?? ""}</span>
            </Row>
            <Row label="page">
              {snap.page ?? "—"} / {snap.total ?? "—"}
              <span className="text-faint"> · spread {snap.spread}</span>
            </Row>
            <Row label="advance">
              <span style={{ color: snap.canAdvance === false ? "var(--leaf-accent)" : undefined }}>
                {n(c?.scrollLeft)} + {n(c?.offsetWidth)} + {n(l?.delta)} = {n(snap.advanceLeft)}{" "}
                &lt;= {n(c?.scrollWidth)} →{" "}
                {snap.canAdvance === null ? "—" : snap.canAdvance ? "turn page" : "NEXT SECTION"}
              </span>
            </Row>
            <Row label="container">
              sl {n(c?.scrollLeft)} · ow {n(c?.offsetWidth)} · sw {n(c?.scrollWidth)} · cw{" "}
              {n(c?.clientWidth)} · oh {n(c?.offsetHeight)}
            </Row>
            <Row label="layout">
              delta {n(l?.delta)} · pw {n(l?.pageWidth)} · cw {n(l?.columnWidth)} · gap{" "}
              {n(l?.gap)} · h {n(l?.height)} · w {n(l?.width)} · div {n(l?.divisor)}
            </Row>
            <Row label="box">
              {n(snap.measuredBox?.width)} × {n(snap.measuredBox?.height)}
              <span className="text-faint"> (relayout → resize)</span>
            </Row>
            <Row label="view">
              iframe {n(v?.iframeWidth)}×{n(v?.iframeHeight)} · el {n(v?.elementWidth)} · w{" "}
              {n(v?.reportedWidth)} · doc {n(v?.bodyScrollWidth)}
            </Row>
            <Row label="images">
              <span
                style={{
                  color: img && img.loadedAfterLayout > 0 ? "var(--leaf-accent)" : undefined,
                }}
              >
                {img?.total ?? 0} · {img?.complete ?? 0} complete ·{" "}
                {img?.loadedAfterLayout ?? 0} late
                {img?.lastLateMs != null ? ` (+${Math.round(img.lastLateMs)}ms)` : ""}
              </span>
            </Row>
            <Row label="img sw">
              {n(img?.scrollWidthAtLayout)} → {n(img?.scrollWidthAfterImages)}
              <span className="text-faint"> (at layout → after images)</span>
            </Row>
            <Row label="device">
              win {device?.win ?? "—"} · vv {device?.visual ?? "—"} · dpr {device?.dpr ?? "—"}
            </Row>
            <Row label="cfi">{snap.cfi ?? "—"}</Row>

            <p className={`${LABEL} pt-2`}>turns ({snap.turns.length})</p>
            <ol className="list-none">
              {snap.turns.length === 0 && <li className={VALUE}>(none yet)</li>}
              {snap.turns.map((t) => (
                <li
                  key={t.n}
                  className={`${VALUE} leading-snug`}
                  style={{ color: t.skipped ? "var(--leaf-accent)" : undefined }}
                >
                  {turnLine(t)}
                </li>
              ))}
            </ol>
          </>
        )}

        {copyState === "manual" && (
          <textarea
            readOnly
            aria-label="Reader debug readout, select and copy"
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 h-40 w-full rounded-sm border bg-transparent p-1 text-ink [font-size:var(--leaf-text-3xs)]"
            style={{ borderColor: "var(--leaf-rule)", fontFamily: "var(--leaf-font-mono)" }}
          />
        )}
      </div>
    </section>
  );
}
