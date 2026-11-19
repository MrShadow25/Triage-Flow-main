async export() {
    const s = TF.engine.summary();

    const rows = [
        ['Shift', s.shift],
        ['Patients', s.total],
        ['Average wait (minutes)', s.avg],
        ['Admitted', s.admitted],
        ['Discharged', s.out]
    ];

    const csv = '\uFEFF' + rows.map(r =>
        r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')
    ).join('\r\n');

    const filename = 'shift-summary-' +
        new Date().toISOString().slice(0, 10) + '.csv';

    // Android app
    if (window.Capacitor?.isNativePlatform()) {
        const file = new File([csv], filename, {
            type: 'text/csv;charset=utf-8'
        });

        try {
            if (!navigator.share || !navigator.canShare ||
                !navigator.canShare({ files: [file] })) {
                throw new Error('File sharing is unavailable');
            }

            await navigator.share({
                files: [file],
                title: 'TriageFlow Shift Summary'
            });
        } catch (error) {
            if (error.name !== 'AbortError') {
                toast('Unable to export summary');
            }
        }

        return;
    }

    // GitHub-hosted and local web app
    const blob = new Blob([csv], {
        type: 'text/csv;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast('Summary download started');
},