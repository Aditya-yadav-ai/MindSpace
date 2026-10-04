chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "capture-visible-tab" || tab?.windowId == null) return;

  void chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
    console.error("MindSpace could not open the side panel.", error);
  });
  void captureVisibleTab(tab.windowId).catch((error) => {
    console.error("MindSpace could not capture the active tab.", error);
  });
});

async function captureVisibleTab(windowId) {
  try {
    const screenshot = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 80,
    });
    await chrome.storage.session.set({
      "mindspace.captured-screenshot.v1": screenshot,
      "mindspace.capture-status.v1": "Screenshot captured.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("MindSpace could not capture the active tab.", error);
    await chrome.storage.session
      .set({ "mindspace.capture-status.v1": `Capture failed: ${message}` })
      .catch(() => undefined);
  }
}