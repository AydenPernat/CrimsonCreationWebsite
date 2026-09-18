const countdown = document.getElementById('success-countdown');
if (countdown) {
    let secondsLeft = 2;
    const timer = window.setInterval(() => {
        secondsLeft -= 1;
        countdown.textContent = String(secondsLeft);
        if (secondsLeft <= 0) {
            window.clearInterval(timer);
            window.location.href = '/';
        }
    }, 1000);
}
