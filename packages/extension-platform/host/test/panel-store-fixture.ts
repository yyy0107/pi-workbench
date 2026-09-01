import type { PanelStorePort, PanelStoreState } from "../src/services/panel-service";

const EMPTY_PANEL_STATE: PanelStoreState = {
  openedPanelIds: [],
  activeByLocation: {},
  collapsedByLocation: {},
  locationByPanelId: {},
  sizeByLocation: {},
  open() {},
  close() {},
  toggle() {},
  activate() {},
  move() {},
  collapse() {},
  expand() {},
  setSize() {},
};

export function createPanelStoreFixture(): PanelStorePort {
  return {
    getState: () => EMPTY_PANEL_STATE,
    getInitialState: () => EMPTY_PANEL_STATE,
    subscribe: () => () => undefined,
  };
}
