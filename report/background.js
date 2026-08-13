// Listen for extension icon click
chrome.action.onClicked.addListener((tab) => {
    // 1. Inject script to extract data from the active K-League tab
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
    });
});

// Listen for messages from the content script (extracted data)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "DATA_EXTRACTED") {
        
        // YOUR GITHUB PAGES URL
        const dashboardUrl = "https://[본인계정].github.io/jbfc-report/g_report.html"; 
        
        // 2. Open a new tab with your dashboard
        chrome.tabs.create({ url: dashboardUrl }, function(newTab) {
            
            // 3. Wait for the dashboard to fully load, then inject the data
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === newTab.id && info.status === 'complete') {
                    // Send the extracted data to the dashboard tab
                    chrome.tabs.sendMessage(tabId, { 
                        action: "INJECT_DATA", 
                        data: request.data 
                    });
                    // Remove listener after successful injection
                    chrome.tabs.onUpdated.removeListener(listener);
                }
            });
        });
    }
});
