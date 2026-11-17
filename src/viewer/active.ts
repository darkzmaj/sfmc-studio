import type { Viewer } from './Viewer';

/** The viewer currently mounted in the editor (for capture/export from other components). */
let current: Viewer | null = null;
export const setActiveViewer = (v: Viewer | null) => { current = v; };
export const activeViewer = () => current;
