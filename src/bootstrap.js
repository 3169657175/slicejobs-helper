        sjInitImageOptimizer();
        init();
        startBackgroundRefresh();
        setInterval(init, 2000);
    };

    if (document.readyState === 'complete') {
        startHelper();
    } else {
        window.addEventListener('load', startHelper);
    }
})();
