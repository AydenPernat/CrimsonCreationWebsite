/* Rare-format decoders load only when a matching logo is selected. */
(() => {
    const input = document.getElementById('admin-project-logo-file');
    if (!input) return;
    const field = document.getElementById('admin-project-logo');
    const status = document.getElementById('project-logo-status');
    const save = document.getElementById('admin-project-submit');
    const scripts = new Map();
    let generation = 0;
    function loadScript(src) {
        if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
            const script = document.createElement('script'); script.src = src;
            script.onload = resolve;
            script.onerror = () => { scripts.delete(src); script.remove(); reject(new Error('Unable to load the image converter. Please try again.')); };
            document.head.append(script);
        }));
        return scripts.get(src);
    }
    function checkSize(width, height) {
        if (!width || !height || width * height > 40000000) throw new Error('Choose an image with fewer than 40 million pixels.');
    }
    async function decode(file) {
        const extension = file.name.split('.').pop().toLowerCase();
        if (['tif', 'tiff'].includes(extension) || /image\/tiff/.test(file.type)) {
            await loadScript('/vendor/pako.min.js'); await loadScript('/vendor/utif.js');
            const buffer = await file.arrayBuffer();
            const frames = UTIF.decode(buffer);
            const frame = frames.find(item => item.t256 && item.t257);
            if (!frame) throw new Error('This TIFF does not contain a readable image.');
            checkSize(frame.t256[0], frame.t257[0]); UTIF.decodeImage(buffer, frame);
            const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
            canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(frame)), frame.width, frame.height), 0, 0);
            return canvas;
        }
        if (['heic', 'heif'].includes(extension) || /image\/hei[cf]/.test(file.type)) {
            const { heicTo } = await import('/vendor/heic-to.js');
            let timer;
            try { file = await Promise.race([heicTo({ blob: file, type: 'image/png' }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('HEIC conversion timed out. Export this image as PNG or JPG and try again.')), 20000); })]); }
            finally { clearTimeout(timer); }
        }
        const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
        if (!file.type.startsWith('image/') && !types[extension]) throw new Error('Choose an image file. Export design files such as PSD, AI or PDF as PNG or SVG first.');
        if (types[extension]) file = new Blob([file], { type: types[extension] });
        const source = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Unable to read this file. Save it locally and try again.'));
            reader.readAsDataURL(file);
        });
        const image = new Image(); image.src = source;
        try { await image.decode(); } catch { throw new Error('This image could not be decoded. Try exporting it as PNG or JPG.'); }
        checkSize(image.naturalWidth, image.naturalHeight); return image;
    }
    function cancel() { generation++; save.disabled = false; }
    field.addEventListener('input', cancel);
    document.getElementById('admin-project-existing').addEventListener('change', cancel);
    document.getElementById('remove-project-logo').addEventListener('click', cancel);
    document.getElementById('admin-project-form').addEventListener('reset', cancel);
    input.addEventListener('change', async () => {
        const file = input.files[0]; if (!file) return;
        const current = ++generation; save.disabled = true; status.textContent = 'Preparing logo…';
        try {
            if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image under 10 MB.');
            const image = await decode(file);
            if (current !== generation) return;
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 256 / Math.max(image.width, image.height));
            canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            let logo = canvas.toDataURL('image/png');
            if (logo.length > 60000) logo = canvas.toDataURL('image/webp', .8);
            if (logo.length > 60000) throw new Error('This logo is too detailed. Choose a simpler image.');
            field.dataset.upload = logo; field.value = '';
            status.textContent = 'Logo ready. Save the project to publish it. Animated images use a still frame.';
        } catch (error) {
            if (current !== generation) return;
            status.textContent = `${error?.message || 'Unable to convert this image.'}${field.dataset.upload || field.value ? ' Your previous logo is unchanged.' : ''}`;
            input.value = '';
        } finally { if (current === generation) save.disabled = false; }
    });
})();
