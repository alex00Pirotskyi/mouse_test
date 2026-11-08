// Inject on click only; the helper is local and the BLE device is Windows-paired.
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id || !/^https?:/.test(tab.url || '')) return;
  try {
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['engine.js']});
  } catch (err) {
    console.warn('Mudra Smart Cursor could not start on this page:',err);
  }
});
chrome.runtime.onMessage.addListener((msg,sender,sendResponse) => {
  if (!msg || msg.type !== 'mudra-bridge-status') return;
  // Read-only loopback endpoint; no firmware controls, no BLE scanning.
  fetch('http://127.0.0.1:8765/api/status',{cache:'no-store'})
    .then(async response => {
      if (!response.ok) throw new Error('Helper HTTP '+response.status);
      return response.json();
    })
    .then(status=>sendResponse({ok:true,status}))
    .catch(error=>sendResponse({ok:false,error:String(error.message||error)}));
  return true;
});
