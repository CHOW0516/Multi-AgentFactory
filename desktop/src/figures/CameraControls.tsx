import { Icon } from "../shell/icons";
import type { useFloorCamera } from "../pages/factory-floor/use-floor-camera";

export function CameraControls({ controls }: { controls: ReturnType<typeof useFloorCamera> }) {
  return <div className="floor-camera-controls floor-panel" role="group" aria-label="Camera controls">
    <button type="button" className="icon-button" aria-label="Zoom in" data-tooltip="Zoom in" onClick={() => controls.zoom(1.22)} disabled={controls.view.zoom >= 2.75}><Icon name="plus" /></button>
    <button type="button" className="icon-button" aria-label="Zoom out" data-tooltip="Zoom out" onClick={() => controls.zoom(1 / 1.22)} disabled={controls.view.zoom <= .58}><Icon name="minus" /></button>
    <span className="floor-camera-divider" />
    <button type="button" className="icon-button" aria-label="Rotate left" data-tooltip="Rotate left" onClick={() => controls.turn(-30)}><Icon name="rotate-left" /></button>
    <button type="button" className="icon-button" aria-label="Rotate right" data-tooltip="Rotate right" onClick={() => controls.turn(30)}><Icon name="rotate-right" /></button>
    <span className="floor-camera-divider" />
    <button type="button" className="icon-button" aria-label="Reset camera" data-tooltip="Reset camera" onClick={controls.reset}><Icon name="home" /></button>
  </div>;
}
