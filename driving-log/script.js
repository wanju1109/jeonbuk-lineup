// DOM Elements
const loginSection = document.getElementById('login-section');
const dashboardSection = document.getElementById('dashboard-section');
const userSelect = document.getElementById('user-select');
const enterBtn = document.getElementById('enter-btn');
const logoutBtn = document.getElementById('logout-btn');
const welcomeMsg = document.getElementById('welcome-msg');
const addBtn = document.getElementById('add-btn');
const logBody = document.getElementById('log-body');

// Fixed fuel rate
const FUEL_PRICE_PER_KM = 1800;

// Event: Enter Dashboard
enterBtn.addEventListener('click', () => {
    const selectedUser = userSelect.value;
    if (selectedUser === "") {
        alert("사용자를 선택해주세요.");
        return;
    }
    
    // Switch views
    loginSection.style.display = 'none';
    dashboardSection.style.display = 'block';
    welcomeMsg.textContent = `${selectedUser}님의 운행일지`;
    
    // Clear previous table data if needed (optional)
    // logBody.innerHTML = ''; 
});

// Event: Logout / Switch User
logoutBtn.addEventListener('click', () => {
    dashboardSection.style.display = 'none';
    loginSection.style.display = 'block';
    userSelect.value = "";
});

// Event: Add Log Entry
addBtn.addEventListener('click', () => {
    // Get input values
    const date = document.getElementById('date-input').value;
    const dest = document.getElementById('dest-input').value;
    const purpose = document.getElementById('purpose-input').value;
    const odoBefore = parseInt(document.getElementById('odo-before').value);
    const odoAfter = parseInt(document.getElementById('odo-after').value);
    const hipass = parseInt(document.getElementById('hipass-input').value) || 0;

    // Validate inputs
    if (!date || !dest || isNaN(odoBefore) || isNaN(odoAfter)) {
        alert("모든 필수 항목을 입력해주세요.");
        return;
    }

    if (odoAfter < odoBefore) {
        alert("주행 후 계기판 거리가 주행 전보다 작을 수 없습니다.");
        return;
    }

    // Calculate distance and fuel cost
    const distance = odoAfter - odoBefore;
    const fuelCost = distance * FUEL_PRICE_PER_KM;

    // Create a new row
    const newRow = document.createElement('tr');

    // Format numbers with commas for readability
    newRow.innerHTML = `
        <td>${date}</td>
        <td>${dest}</td>
        <td>${purpose}</td>
        <td>${odoBefore.toLocaleString()}</td>
        <td>${odoAfter.toLocaleString()}</td>
        <td><strong>${distance.toLocaleString()}</strong></td>
        <td><strong>${fuelCost.toLocaleString()}</strong></td>
        <td>${hipass.toLocaleString()}</td>
    `;

    // Append the row to the table body
    logBody.appendChild(newRow);

    // Reset inputs
    document.getElementById('dest-input').value = '';
    document.getElementById('odo-before').value = '';
    document.getElementById('odo-after').value = '';
    document.getElementById('hipass-input').value = '';
});
