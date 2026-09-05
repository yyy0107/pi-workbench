import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Uses the existing Electron smoke-test CDP transport for both Web and Desktop pages.
const requireDesktop = createRequire(
  new URL("../apps/desktop-electron/package.json", import.meta.url),
);
const { createCdpClient } = requireDesktop("./scripts/packaged-app-smoke.cjs");

export function checkWorkbenchStyleScope() {
  const shell = document.querySelector("[data-workbench-shell]");
  const button =
    shell?.querySelector('[data-slot="message-actions"] .aui-button-icon') ??
    shell?.querySelector("[data-sidebar-actions] .aui-button-icon") ??
    shell?.querySelector("button.aui-button-icon");
  if (!shell || !button) throw new Error("Open a Workbench page before running the scope check.");
  const expect = (value, expected, label) => {
    if (!Number.isFinite(value) || Math.abs(value - expected) > 0.06)
      throw new Error(`${label}: expected ${expected}, received ${value}`);
  };
  const equal = (value, expected, label) => {
    if (value !== expected) throw new Error(`${label}: expected ${expected}, received ${value}`);
  };
  const height = (element) => element.getBoundingClientRect().height;
  const iconSize = (element) => element.querySelector("svg").getBoundingClientRect().width;
  const token = (element, name) => getComputedStyle(element).getPropertyValue(name).trim();
  const milliseconds = (element, name) => {
    const value = token(element, name);
    return parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
  };
  const fixtures = [];
  function append(parent, attributes = {}) {
    const element = document.createElement("div");
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    parent.append(element);
    return element;
  }
  function control(parent, className = "") {
    const clone = button.cloneNode(false);
    clone.removeAttribute("id");
    clone.removeAttribute("style");
    clone.classList.add(...className.split(" ").filter(Boolean));
    const svg = button.querySelector("svg").cloneNode(true);
    svg.removeAttribute("id");
    clone.append(svg);
    parent.append(clone);
    return clone;
  }
  function fixture() {
    const root = shell.cloneNode(false);
    fixtures.push(root);
    root.removeAttribute("id");
    root.inert = true;
    root.setAttribute("aria-hidden", "true");
    root.style.position = "fixed";
    root.style.left = "-10000px";
    root.style.width = "1000px";
    root.style.height = "1000px";
    root.style.display = "block";
    root.setAttribute("data-window-resizing", "false");
    document.body.append(root);
    const header = append(root, { "data-workbench-surface": "header" });
    header.style.height = "var(--workbench-header-height)";
    const headerButton = control(header);
    const footer = append(root);
    footer.style.height = "var(--workbench-statusbar-height)";
    const sidebar = append(root, { "data-workbench-surface": "sidebar" });
    const group = append(sidebar, { class: "sidebar-group" });
    const row = append(group, { class: "sidebar-row" });
    const trigger = document.createElement("button");
    trigger.className = "sidebar-row-trigger";
    row.append(trigger);
    append(group, { class: "sidebar-row" });
    const actions = append(row, {
      "data-sidebar-actions": "",
      "data-sidebar-actions-mobile-touch": "",
    });
    const sidebarButton = control(actions);
    const conversation = append(root, { "data-slot": "workbench-conversation" });
    const messageActions = append(conversation, { "data-slot": "message-actions" });
    const messageButton = control(messageActions);
    const composer = append(conversation, { "data-slot": "workbench-composer-shell" });
    const composerActions = append(composer, { "data-slot": "workbench-composer-actions" });
    const primaryButton = control(composerActions, "aui-composer-primary-action");
    const portal = append(root, { "data-workbench-portal-container": "" });
    const popup = append(portal, { "data-workbench-composer-popup": "" });
    const menu = append(portal, { class: "sidebar-menu" });
    const item = append(menu, { "data-slot": "dropdown-menu-item" });
    composer.style.borderRadius = "var(--composer-radius)";
    popup.style.borderRadius = "var(--composer-inner-radius)";
    const unrelatedRow = append(root, { class: "sidebar-row" });
    return {
      root,
      header,
      headerButton,
      footer,
      sidebar,
      group,
      row,
      trigger,
      sidebarButton,
      conversation,
      messageActions,
      messageButton,
      composer,
      primaryButton,
      popup,
      menu,
      item,
      unrelatedRow,
    };
  }
  try {
    const a = fixture();
    const b = fixture();
    expect(height(a.header), 40, "Shell header height");
    expect(height(a.footer), 28, "Shell statusbar height");
    expect(height(a.row), 31.5, "Sidebar row height");
    expect(height(a.trigger), height(a.row), "Sidebar click target follows background");
    expect(parseFloat(getComputedStyle(a.group).rowGap), 2, "Sidebar list gap");
    expect(iconSize(a.sidebarButton), 16, "Sidebar icon default");
    expect(iconSize(a.messageButton), 16, "Message action icon default");
    expect(height(a.messageButton), 32, "Message action frame default");
    expect(height(a.primaryButton), 32, "Composer primary frame default");
    equal(token(a.root, "--sidebar-row-height"), "", "No sidebar geometry at Shell root");
    equal(token(a.header, "--composer-radius"), "", "No Composer geometry in header");
    equal(
      getComputedStyle(a.unrelatedRow).display,
      "block",
      "Sidebar classes outside sidebar are inert",
    );
    a.sidebar.style.setProperty("--sidebar-row-height", "45px");
    a.sidebar.style.setProperty("--sidebar-action-icon-size", "20px");
    expect(height(a.row), 45, "Sidebar row override");
    expect(height(a.trigger), 45, "Sidebar trigger override");
    expect(iconSize(a.sidebarButton), 20, "Sidebar action icon override");
    expect(iconSize(a.headerButton), 16, "Sidebar override does not reach header");
    expect(iconSize(a.messageButton), 16, "Sidebar override does not reach conversation");
    expect(height(b.row), 31.5, "Second Shell keeps its sidebar height");
    a.conversation.style.setProperty("--thread-icon-size", "18px");
    expect(iconSize(a.messageButton), 18, "Conversation icon override");
    a.messageActions.style.setProperty("--message-action-icon-size", "22px");
    expect(iconSize(a.messageButton), 22, "Message action override");
    expect(iconSize(a.sidebarButton), 20, "Message override does not reach sidebar");
    expect(iconSize(b.messageButton), 16, "Second Shell keeps its message icon");
    a.composer.style.setProperty("--composer-primary-icon-size", "20px");
    expect(iconSize(a.primaryButton), 20, "Composer primary icon override");
    a.primaryButton.querySelector("svg").classList.add("aui-composer-stop-icon");
    expect(iconSize(a.primaryButton), 12, "Stop glyph retains its own size");
    for (const [preset, radius] of Object.entries({
      default: 24,
      square: 0,
      subtle: 12,
      compact: 16,
      soft: 28,
      rounded: 32,
      "extra-rounded": 40,
    })) {
      a.root.setAttribute("data-workbench-corner-radius", preset);
      expect(
        parseFloat(getComputedStyle(a.composer).borderRadius),
        radius,
        `Composer ${preset} radius`,
      );
      expect(
        parseFloat(getComputedStyle(a.popup).borderRadius),
        Math.max(0, radius - 2),
        `Portal ${preset} radius`,
      );
    }
    equal(token(a.menu, "--sidebar-row-height"), "", "Sidebar menu does not inherit list geometry");
    if (matchMedia("(hover: none), (pointer: coarse), (max-width: 39.999rem)").matches) {
      expect(parseFloat(getComputedStyle(a.item).minHeight), 44, "Sidebar menu touch target");
    }
    const originalThumb = token(b.root, "--scrollbar-thumb");
    a.root.style.setProperty("--foreground", "rgb(255, 0, 0)");
    equal(
      token(b.root, "--scrollbar-thumb"),
      originalThumb,
      "Scrollbar theme is isolated by Shell",
    );
    if (token(a.root, "--scrollbar-thumb") === originalThumb)
      throw new Error("Scrollbar must resolve its Shell theme");
    a.root.setAttribute("data-workbench-appearance", "");
    a.root.style.removeProperty("--background");
    a.root.style.setProperty("--workbench-light-background", "rgb(255, 255, 255)");
    a.root.style.setProperty("--workbench-dark-background", "rgb(0, 0, 0)");
    a.root.classList.remove("dark");
    const lightBackground = token(a.root, "--background");
    a.root.classList.add("dark");
    if (token(a.root, "--background") === lightBackground) {
      throw new Error("Shell theme must follow its own light/dark state");
    }
    a.headerButton.querySelector("svg").setAttribute("stroke-width", "2.25");
    expect(
      parseFloat(getComputedStyle(a.headerButton.querySelector("svg")).strokeWidth),
      2.25,
      "Explicit glyph stroke is not overridden by the document or shared Button",
    );
    a.root.setAttribute("data-window-resizing", "true");
    expect(milliseconds(a.root, "--layout-motion-duration"), 0, "Native width motion is immediate");
    expect(
      milliseconds(a.header, "--sidebar-motion-duration"),
      330,
      "Sidebar state still animates during resize",
    );
    expect(
      milliseconds(a.conversation, "--thread-index-motion-duration"),
      330,
      "Index state still animates during resize",
    );
    equal(
      token(a.conversation, "--desktop-window-controls-inset-end"),
      "",
      "Titlebar env dependency stays out of conversation",
    );
    return {
      passed: true,
      width: innerWidth,
      dpr: devicePixelRatio,
      rowHeight: 31.5,
      listGap: 2,
      checks:
        "area and installation isolation, control sizes, Portal radii, scrollbar theme, discrete resize motion",
    };
  } finally {
    for (const fixture of fixtures) fixture.remove();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const endpoint = process.argv[2];
  if (!endpoint)
    throw new Error("Usage: node scripts/check-workbench-style-scope.mjs <renderer-websocket-url>");
  const client = createCdpClient(endpoint, {
    WebSocketImpl: requireDesktop("ws"),
    timeoutMs: 30000,
    timers: globalThis,
  });
  try {
    const result = await client.evaluate(
      `(() => { try { return (${checkWorkbenchStyleScope.toString()})(); } catch (error) { return { error: error.message }; } })()`,
    );
    if (result.error) throw new Error(result.error);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    client.close();
  }
}
