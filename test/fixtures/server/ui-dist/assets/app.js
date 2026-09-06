export const labels = {
  title: "Dashboard",
  placeholder: "Message the agent — describe what you want done…",
  ariaLabel: "Open company switcher",
  description: "Save changes before leaving this page."
};
export const machine = {
  id: "issue-1",
  status: "open",
  href: "/CMP/issues",
  className: "flex items-center",
  route: "/CMP/dashboard"
};
const current = "open";
if (current === "open") {
  void 0;
}
switch (current) {
  case "todo":
    break;
  default:
    break;
}
document.querySelector(".board-root");
localStorage.getItem("paperclip.theme");
const tpl = `Hello ${"world"}`;
const promptPayload = { systemPrompt: "You are the CEO. Keep this English." };
const defaultName = (null) ?? "AGENTS.md";
function onDirtyChange(v) { return v; }
const draft = "line\n";
const saved = "line\n";
void onDirtyChange(defaultName);
const bundled = ((null)??"AGENTS.md"),isDirty=draft!==null&&draft!==saved;
void bundled;
void isDirty;
void promptPayload;
void tpl;
export const confirmText = "Discard unsaved agent configuration changes?";
