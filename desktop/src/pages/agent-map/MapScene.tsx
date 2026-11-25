import { memo, useEffect, useId, useMemo, useRef, type MutableRefObject } from "react";
import type { AgentSummary } from "../../api/types";
import { createMapArt, type MapAgent, type Station } from "../../figures/agent-geometry";
import { compareDepth } from "../../figures/geometry";
import { useFigureFrames, useMotionVisibility } from "../../figures/motion";
import { activateOnKey } from "../../figures/figure-ui";
import { CameraControls } from "../../figures/CameraControls";
import { floorProjection, floorViewport, locateInView, projectionAngles } from "../factory-floor/floor-camera";
import { useFloorCamera } from "../factory-floor/use-floor-camera";
import { iso } from "../../iso/iso-kit";
import type { Selection } from "./model";
import { parcelFor, scheduleParcel, type Message, type ScheduledParcel } from "./model";

type MapArt = ReturnType<typeof createMapArt>;
const poolSize = 48;
const parcelShapes = {
  task: "M-6-3 1-6 7-3 0 1Z M-6-3V3L0 6V1Z M0 1 7-3V3L0 6Z",
  result: "M-7-2 2-6 7-4-2 0Z M-7-2v4l5 2V0Z M-2 0l9-4v4l-9 4Z",
  event: "M0-6 7-1 0 5-7-1Z",
  failed: "M-7-3 0-6 7-3 7 3 0 6-7 3Z",
};

function paintParcel(path: SVGPathElement, parcel: ScheduledParcel, time: number, reduced: boolean, railArt: MapArt["railArt"]) {
  const fraction = Math.max(0, Math.min(1, (time - parcel.start) / (parcel.end - parcel.start)));
  const stationEnd = parcel.outbound ? 1 : 0;
  const slide = parcel.kind === "failed" ? Math.max(0, (fraction - .2) / .8) : fraction;
  const moving = parcel.outbound ? slide : 1 - slide;
  const sample = railArt[parcel.link].sample(reduced ? (parcel.kind === "failed" ? 1 : stationEnd) : moving);
  const shake = !reduced && parcel.kind === "failed" && fraction < .2 ?
    Math.sin((time - parcel.start) / 19) * Math.sin(fraction / .2 * Math.PI) * 2 : 0;
  path.setAttribute("transform", `translate(${sample[0] + shake} ${sample[1]})`);
  path.setAttribute("opacity", String(reduced ? .92 : Math.max(0, Math.min(1, fraction * 12, (parcel.end + 250 - time) / 180))));
  if (path.getAttribute("data-parcel") !== parcel.id) {
    path.setAttribute("d", parcelShapes[parcel.kind]);
    path.setAttribute("data-parcel", parcel.id);
    path.setAttribute("data-testid", "agent-token");
    path.setAttribute("data-rail", parcel.link);
    path.setAttribute("data-kind", parcel.kind);
  }
}

function clearParcel(node: SVGPathElement) {
  if (node.hasAttribute("data-parcel")) {
    node.setAttribute("opacity", "0");
    node.removeAttribute("data-parcel");
    node.removeAttribute("data-testid");
  }
}

const Ground = memo(function Ground({ names, art }: { names: Station[]; art: MapArt }) {
  const { roomArt, ducts, ringArt, railArt } = art;
  return <g aria-hidden="true" dangerouslySetInnerHTML={{ __html: roomArt + ducts(names) + ringArt +
    names.map((name) => railArt[name].art).join("") }} />;
});

const StationUnit = memo(function StationUnit({ name, stats, failed, active, onInspect, art, selected, onHover }: {
  art: MapArt; selected: boolean; name: MapAgent; stats?: AgentSummary; failed: boolean; active: boolean; onInspect: (name: MapAgent) => void;
  onHover: (name: MapAgent | null) => void;
}) {
  const item = art.stationArt[name];
  const show = () => onInspect(name);
  const counter = stats ? `${stats.queue_depth} | ${stats.in_progress}` : "— | —";
  return <g transform={item.transform} className="p5-scene-target p5-station" data-station={name} data-testid={`agent-node-${name}`}
    data-active={selected || undefined} aria-pressed={selected} data-failed={failed || undefined} data-working={active || undefined} role="button" tabIndex={0}
    aria-label={`${item.label} station`} onClick={show} onKeyDown={(event) => activateOnKey(event, show)}
    onPointerEnter={() => onHover(name)} onPointerLeave={() => onHover(null)} onFocus={() => onHover(name)} onBlur={() => onHover(null)}>
    <g dangerouslySetInnerHTML={{ __html: item.body }} />
    <g transform={item.plate} aria-hidden="true">
      <rect className="p5-station-plate" width={name === "orchestrator" ? 75 : 55} height="11" rx="1.3" />
      <circle className="p5-station-lamp" cx="4.5" cy="5.5" r="1.7" />
      <text className="p5-display-text" x="8.5" y="7.5" fontSize="6.4">{item.label}</text>
      <rect className="p5-station-plate" x="77" width="31" height="11" rx="1.3" />
      <text className="p5-display-text" x="80" y="7.5" fontSize={Math.min(6.4, 40 / counter.length)}>{counter}</text>
    </g>
    <title>{item.label} · {stats?.queue_depth ?? "Unknown"} in queue · {stats?.in_progress ?? "Unknown"} in progress</title>
  </g>;
});

export type ReplayMotion = {
  parcels: ScheduledParcel[]; playing: boolean; speed: 1 | 4; end: number; position: MutableRefObject<number>;
  onTick: (position: number) => void; onEnd: () => void;
};

export function MapScene({ names, summaries, live, replay, onStation, onRail, focus, selection, hover, onHover }: {
  focus: Selection | null; selection: Selection | null; names: Station[]; summaries: AgentSummary[]; live: Message[]; replay: ReplayMotion | null;
  onStation: (name: MapAgent) => void; onRail: (name: Station) => void;
  hover: MapAgent | null; onHover: (name: MapAgent | null) => void;
}) {
  const scene = useRef<SVGSVGElement>(null);
  const hint = useId();
  const controls = useFloorCamera(scene);
  const { view } = controls;
  const [azimuth, elevation] = projectionAngles(view);
  const camera = useMemo(() => floorProjection(azimuth, elevation), [azimuth, elevation]);
  const art = useMemo(() => createMapArt(camera), [camera]);
  const { stationArt, railArt } = art;
  const lastFocus = useRef<Selection | null>(null);
  useEffect(() => {
    if (!focus || focus === lastFocus.current) return;
    lastFocus.current = focus;
    controls.animate(locateInView(view, stationArt[focus.name].depthPoint, camera, [0, 18]));
  }, [focus, controls, view, stationArt, camera]);
  const parcels = useRef<SVGPathElement[]>([]);
  const liveClock = useRef(0);
  const liveQueue = useRef<ScheduledParcel[]>([]);
  const liveLanes = useRef(new Map<Station, ScheduledParcel>());
  const seen = useRef(new Set<string>());
  const renderedActivity = useRef(new Map<Station, string>());
  const { visible, reduced } = useMotionVisibility(scene);
  const sorted = useMemo(() => (["orchestrator", ...names] as MapAgent[])
    .sort((left, right) => compareDepth(camera, stationArt[left].depthPoint, stationArt[right].depthPoint)), [names, camera, stationArt]);
  const recent = useMemo(() => {
    const byStation = new Map<Station, ScheduledParcel["kind"]>();
    for (const message of live) {
      const parcel = parcelFor(message);
      if (parcel) byStation.set(parcel.link, parcel.kind);
    }
    return byStation;
  }, [live]);

  useEffect(() => {
    for (const message of live) {
      if (seen.current.has(message.message_id)) continue;
      seen.current.add(message.message_id);
      if (seen.current.size > 2000) {
        const oldest = seen.current.values().next().value;
        if (oldest !== undefined) seen.current.delete(oldest);
      }
      const parcel = parcelFor(message);
      if (parcel && visible && !reduced && !replay && names.includes(parcel.link)) {
        liveQueue.current.push(scheduleParcel(parcel, liveClock.current, liveLanes.current));
      }
    }
    if (!visible || reduced || replay) {
      liveQueue.current = [];
      liveLanes.current.clear();
    }
  }, [live, names, reduced, replay, visible]);

  function paint(queue: ScheduledParcel[], time: number, staticPose: boolean) {
    const onTrack = queue.filter((parcel) => names.includes(parcel.link) && parcel.start <= time && parcel.end + 250 >= time);
    parcels.current.forEach((path, index) => {
      if (onTrack[index]) paintParcel(path, onTrack[index], time, staticPose, railArt);
      else clearParcel(path);
    });
    const activity = new Map<Station, string>();
    if (replay) {
      for (const parcel of onTrack) activity.set(parcel.link, parcel.kind);
    }
    for (const name of names) {
      const next = activity.get(name);
      if (renderedActivity.current.get(name) === next) continue;
      const station = scene.current?.querySelector(`[data-station="${name}"]`);
      if (next) station?.setAttribute("data-replay-state", next);
      else station?.removeAttribute("data-replay-state");
    }
    renderedActivity.current = activity;
  }

  const replayRefresh = useRef(0);
  useFigureFrames(visible && (!reduced || Boolean(replay?.playing)), (_, delta) => {
    if (replay) {
      const previous = replay.position.current ?? 0;
      const next = replay.playing ? Math.min(replay.end, previous + delta * replay.speed) : previous;
      if (replay.playing) replay.onTick(next);
      if (!reduced || Math.floor(next / 200) !== replayRefresh.current || next === replay.end) {
        paint(replay.parcels, next, reduced);
        replayRefresh.current = Math.floor(next / 200);
      }
      if (replay.playing && next >= replay.end) replay.onEnd();
    } else {
      liveClock.current += delta;
      const time = liveClock.current;
      liveQueue.current = liveQueue.current.filter((parcel) => parcel.end + 250 >= time);
      paint(liveQueue.current, time, false);
    }
  });

  useEffect(() => {
    if (replay) {
      paint(replay.parcels, replay.position.current ?? 0, reduced);
    } else if (reduced) {
      const latest = [...live].reverse().map(parcelFor).find((parcel) => parcel && names.includes(parcel.link));
      paint(latest ? [{ ...latest, start: 0, end: 1100 }] : [], 1100, true);
    } else if (!visible) {
      parcels.current.forEach(clearParcel);
    }
  });

  const matrix = `translate(${floorViewport.x + view.x} ${floorViewport.y + view.y}) scale(${view.zoom}) translate(${-floorViewport.x} ${-floorViewport.y})`;
  const selectedStation = selection && stationArt[selection.name];
  const marker = selectedStation && iso([selectedStation.depthPoint[0], selectedStation.depthPoint[1], 100], camera);
  return <>
    <span className="sr-only" id={hint}>Drag to orbit. Shift and drag or middle-drag to pan. Scroll or pinch to zoom. Use arrows, plus, minus and Home on the keyboard.</span>
    <div className="floor-viewport" data-moving={controls.moving || undefined}><svg ref={scene} className="iso-svg p5-scene floor-model"
    data-azimuth={azimuth} data-elevation={elevation} data-zoom={view.zoom.toFixed(2)}
    viewBox={`0 0 ${floorViewport.width} ${floorViewport.height}`} aria-label="Interactive isometric agent control room" role="group" tabIndex={0}
    aria-describedby={hint} {...controls.handlers} onClickCapture={(event) => {
      if (!controls.moved.current || event.detail === 0) return;
      event.stopPropagation(); controls.moved.current = false;
    }}>
    <g transform={matrix}>
    <Ground names={names} art={art} />
    {names.map((name) => <path key={name} className="p5-rail-hit" d={railArt[name].hit} role="button" tabIndex={0}
      aria-label={`${stationArt[name].label} rail`} onClick={() => onRail(name)}
      onKeyDown={(event) => activateOnKey(event, () => onRail(name))} />)}
    <g aria-hidden="true" pointerEvents="none">
      {Array.from({ length: poolSize }, (_, index) => <path key={index} className="p5-parcel" opacity="0"
        ref={(node) => { if (node) parcels.current[index] = node; }} />)}
    </g>
    {sorted.map((name) => {
      const stats = summaries.find((summary) => summary.name === name);
      const kind = recent.get(name as Station);
      const failed = !replay && kind === "failed";
      return <StationUnit key={name} name={name} stats={stats} failed={failed} active={!replay && (kind === "task" || Boolean(stats?.in_progress))}
        onInspect={onStation} art={art} selected={(selection?.name ?? hover) === name} onHover={onHover} />;
    })}
    {marker && selectedStation && <g className="floor-marker" transform={`translate(${marker.join(" ")}) scale(${1 / view.zoom})`} aria-hidden="true" pointerEvents="none">
      <rect x="-68" y="-26" width="136" height="25" rx="7" />
      <path d="M-4-1 0 4 4-1Z" /><text x="0" y="-10" textAnchor="middle">{selectedStation.label}</text>
    </g>}
    </g>
  </svg></div><CameraControls controls={controls} /></>;
}
