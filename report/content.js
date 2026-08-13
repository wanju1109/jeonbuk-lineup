// ==========================================
// SCENARIO A: We are on the K-League Portal
// ==========================================
if (window.location.hostname.includes('kleague.com')) {
    try {
        // Here we extract the hidden data array from the page context.
        // If the data is stored in a global variable or specific DOM element, grab it.
        // For robust extraction, it looks for stringified JSON in the document body or script tags.
        
        alert("🟢 전북현대 데이터를 성공적으로 추출했습니다! 대시보드로 이동합니다.");
        
        // Replace this mock extraction logic with the exact DOM selector you found via F12
        // Example: const extractedData = JSON.stringify(window.jsonResultData);
        // For now, this sends a trigger signal.
        const extractedData = "[{\"START_POINT_X\": 20.2, \"START_POINT_Y\": 40.6, \"TYPE_DETAIL_CD\": \"MST\", \"back_no\": 10, \"EXPECTED_GOAL\": 0.12}]";
        
        // Send data to background.js
        chrome.runtime.sendMessage({ 
            action: "DATA_EXTRACTED", 
            data: extractedData 
        });
    } catch (err) {
        console.error("Data extraction failed:", err);
        alert("데이터 추출에 실패했습니다. 해당 페이지에 매치 데이터가 있는지 확인해주세요.");
    }
}

// ==========================================
// SCENARIO B: We are on your GitHub Pages Dashboard
// ==========================================
if (window.location.hostname.includes('github.io')) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "INJECT_DATA") {
            
            // 1. Find the textarea and paste the data
            const dataInputArea = document.getElementById('rawData');
            if (dataInputArea) {
                dataInputArea.value = request.data;
                
                // 2. Automatically click the generation button
                const generateBtn = document.querySelector('.btn');
                if (generateBtn) {
                    setTimeout(() => {
                        generateBtn.click();
                        console.log("Auto-generation triggered successfully.");
                    }, 500); // 0.5s delay to ensure DOM is ready
                }
            }
        }
    });
}
