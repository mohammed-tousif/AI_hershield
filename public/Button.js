// Add this function to your frontend JavaScript
async function getSafetyInfo(start, end) {
    try {
        const response = await fetch('/get-route-safety', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                start: start,
                end: end
            })
        });
        
        const data = await response.json();
        if (data.status === 'success') {
            // Update your UI with safety information
            const routeInfo = document.getElementById('routeInfo');
            routeInfo.innerHTML += `
                <p><strong>Route Safety:</strong> ${data.safety_info.route_safety.level}</p>
                <p><strong>Safety Score:</strong> ${data.safety_info.route_safety.score}/10</p>
            `;
            
            // Display warnings if any
            if (data.safety_info.warnings.length > 0) {
                routeInfo.innerHTML += `<p class="warning">${data.safety_info.warnings.join('<br>')}</p>`;
            }
        }
    } catch (error) {
        console.error('Error fetching safety info:', error);
    }
}