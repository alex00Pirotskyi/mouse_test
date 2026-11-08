// Inject on click only: no persistent all-site host permissions.
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !/^https?:/.test(tab.url || '')) return;
  try {
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['engine.js']});
  } catch (err) {
    console.warn('Mudra Smart Cursor could not start on this page:',err);
  }
});
