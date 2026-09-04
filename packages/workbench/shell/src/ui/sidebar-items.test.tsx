import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsibleTrigger } from "./collapsible";
import {
  SidebarActions,
  SidebarGroup,
  SidebarRow,
  SidebarSectionHeading,
  SidebarStatus,
} from "./index";

test("section headings are non-selectable drop targets with sibling actions", () => {
  const html = renderToStaticMarkup(
    <SidebarGroup
      open
      header={
        <SidebarSectionHeading
          label="Projects"
          expanded
          description="Collapse section"
          drag={{ ref() {}, dropPosition: "inside", shouldSuppressClick: () => false }}
          actions={
            <SidebarActions>
              <button type="button">Add project</button>
            </SidebarActions>
          }
        />
      }
    >
      <span>Folder</span>
    </SidebarGroup>,
  );
  assert.match(html, /<h2\b[^>]*>Projects<\/h2>/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-controls=/);
  assert.match(html, /data-sidebar-drop="inside"/);
  assert.doesNotMatch(
    html,
    /data-slot="sidebar-row"|data-workbench-selection-surface|data-active=|aria-current=/,
  );
  assert.equal((html.match(/<button\b/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
});

test("collapsible rows keep action buttons outside the primary trigger", () => {
  const html = renderToStaticMarkup(
    <SidebarGroup
      open
      header={
        <SidebarRow
          label="Project"
          trigger={<CollapsibleTrigger />}
          icon={<span>Folder</span>}
          hoverIcon={<span>Expand</span>}
          actions={
            <SidebarActions>
              <button type="button">Options</button>
            </SidebarActions>
          }
        />
      }
    >
      <span>Conversation</span>
    </SidebarGroup>,
  );
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-controls=/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
  assert.match(html, /data-sidebar-actions=""/);
});

test("the default icon remains available without a hover replacement; activity and waiting coexist", () => {
  const html = renderToStaticMarkup(
    <SidebarRow
      active
      label="Conversation"
      icon={<span>Running animation</span>}
      description="Generating"
      status={<SidebarStatus>Waiting for input</SidebarStatus>}
    />,
  );
  assert.match(html, /Running animation/);
  assert.doesNotMatch(html, /data-has-hover-icon/);
  assert.match(html, /Generating/);
  assert.match(html, /Waiting for input/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /aria-describedby="[^"]+ [^"]+"/);
});
