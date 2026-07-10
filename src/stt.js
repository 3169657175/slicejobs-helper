    // ==========================================
    // AI 语音重识别字幕模块 (SenseVoice STT)
    // ==========================================
    // AI 语音重识别字幕模块 (SenseVoice STT)
    // ==========================================
    // AI 语音重识别字幕模块 (SenseVoice STT)
    // ==========================================
    const STT_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
    const STT_MODEL   = 'whisper-large-v3';
    const STT_KEY_LS  = 'sj_groq_api_key';
    const SF_STT_API_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
    const SF_STT_MODEL = 'FunAudioLLM/SenseVoiceSmall';
    const SF_KEY_LS = 'sj_siliconflow_api_key';
    const STT_CACHE_PREFIX = 'stt_cache_v2_';
    const STT_AI_ENABLED_LS = 'sj_stt_ai_enabled';
    const STT_SHORT_AUDIO_MAX_SECONDS = 360;
    const STT_SHORT_AUDIO_MAX_BYTES = 8 * 1024 * 1024;

    function sttGetGroqKey() { return localStorage.getItem(STT_KEY_LS) || ''; }
    function sttSaveGroqKey(k) { localStorage.setItem(STT_KEY_LS, k.trim()); }
    function sttGetSiliconFlowKey() { return localStorage.getItem(SF_KEY_LS) || ''; }
    function sttSaveSiliconFlowKey(k) { localStorage.setItem(SF_KEY_LS, k.trim()); }
    function sttGetKey() { return sttGetGroqKey(); }
    function sttSaveKey(k) { sttSaveGroqKey(k); }
    function sttIsAiEnabled() { return localStorage.getItem(STT_AI_ENABLED_LS) === '1'; }
    function sttSetAiEnabled(enabled) { localStorage.setItem(STT_AI_ENABLED_LS, enabled ? '1' : '0'); }

    function sttHasAnyProviderKey() {
        return !!(sttGetSiliconFlowKey() || sttGetGroqKey());
    }

    function sttParseDurationFromSrc(src) {
        const m = String(src || '').match(/(?:^|[_-])dur(\d+)(?:[_\-.]|$)/i);
        return m ? Number(m[1]) : 0;
    }

    function sttChooseProvider(audio, blob, src) {
        const providers = sttChooseProviders(audio, blob, src);
        return providers[0] || null;
    }

    // 从 Blob 中获取真实音频时长（通过虚拟 Audio 元素，不产生额外网络开销，支持本地缓存）
    function sttGetAudioDurationFromBlob(blob) {
        return new Promise((resolve) => {
            try {
                const url = URL.createObjectURL(blob);
                const audio = new Audio();
                audio.src = url;
                
                // 设置超时防止在非音频文件上挂起
                const timer = setTimeout(() => {
                    URL.revokeObjectURL(url);
                    resolve(0);
                }, 2000);

                audio.addEventListener('loadedmetadata', () => {
                    clearTimeout(timer);
                    const dur = audio.duration;
                    URL.revokeObjectURL(url);
                    resolve(Number.isFinite(dur) ? dur : 0);
                });

                audio.addEventListener('error', () => {
                    clearTimeout(timer);
                    URL.revokeObjectURL(url);
                    resolve(0);
                });
            } catch (err) {
                console.warn('[STT] Failed to get duration from blob:', err);
                resolve(0);
            }
        });
    }

    function sttChooseProviders(audio, blob, src) {
        const duration = Number(audio && audio.duration) || sttParseDurationFromSrc(src);
        const sfKey = sttGetSiliconFlowKey();
        const groqKey = sttGetGroqKey();
        const sf = sfKey ? { id: 'siliconflow', label: 'SiliconFlow', url: SF_STT_API_URL, model: SF_STT_MODEL, key: sfKey } : null;
        const groq = groqKey ? { id: 'groq', label: 'Groq', url: STT_API_URL, model: STT_MODEL, key: groqKey } : null;

        // 如果我们有明确的 duration（从 audio 元素或文件名解析得到）
        if (duration > 0) {
            if (duration <= STT_SHORT_AUDIO_MAX_SECONDS) {
                // 少于6分钟：直接且优先使用硅基流动，Groq 作为备选
                return [sf, groq].filter(Boolean);
            } else {
                // 大于6分钟：直接且优先使用 Groq，硅基流动作为备选
                return [groq, sf].filter(Boolean);
            }
        }

        // 如果实在没有 duration，退而求其次用 blob 大小判断（修改阈值为 2.5MB，对应约 6 分钟低码率音频）
        const isShort = !!blob && blob.size > 0 && blob.size <= 2.5 * 1024 * 1024;
        if (isShort) {
            return [sf, groq].filter(Boolean);
        } else {
            return [groq, sf].filter(Boolean);
        }
    }

    function sttBuildFormData(provider, blob) {
        const fd = new FormData();
        fd.append('file', blob, 'audio.mp3');
        fd.append('model', provider.model);

        if (provider.id === 'groq') {
            fd.append('response_format', 'verbose_json');
            fd.append('language', 'zh');
            fd.append('temperature', '0');
            fd.append('prompt', '这是门店审核录音，只转写真实对话。核心词：脉动、卖动、麦动、1L、一升、大瓶、电解质、库存、仓库、整箱、几箱、几件、现货、还有货、多少钱、价格、元、块。请保留中文标点，并按说话停顿分句。不要编造新闻、广告、订阅、故事、外语或无关内容；听不清就留空。');
        }
        return fd;
    }

    function sttTranscribeBlob(provider, blob) {
        const fd = sttBuildFormData(provider, blob);
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: provider.url,
                headers: { 'Authorization': 'Bearer ' + provider.key },
                data: fd,
                onload: r => {
                    if (r.status === 200) {
                        resolve(r.responseText);
                    } else {
                        console.error(`[STT] ${provider.label} raw error:`, r.responseText);
                        let errMsg = r.status;
                        try {
                            const j = JSON.parse(r.responseText);
                            errMsg = (j.error && j.error.message) || j.message || errMsg;
                        } catch {}
                        reject(new Error(provider.label + ' API ' + errMsg));
                    }
                },
                onerror: () => reject(new Error(provider.label + ' 网络错误')),
                ontimeout: () => reject(new Error(provider.label + ' 请求超时'))
            });
        });
    }

    async function sttTranscribeWithFallback(providers, blob, onProviderStart) {
        let lastError = null;
        for (let i = 0; i < providers.length; i++) {
            const provider = providers[i];
            try {
                if (onProviderStart) onProviderStart(provider);
                const resultText = await sttTranscribeBlob(provider, blob);
                
                // 如果是最后一个 provider，直接返回，不做信号判定
                if (i === providers.length - 1) {
                    return resultText;
                }

                // 否则，解析结果并检查是否有有效业务信号。如果无信号且还有下一个 provider，我们继续 fallback。
                const segs = parseApiResponse(resultText, 0);
                if (sttHasUsefulBusinessSignal(segs)) {
                    return resultText;
                } else {
                    console.warn(`[STT] ${provider.label} 识别成功但未检测到有效业务信号，将尝试 fallback 到下一个服务...`);
                }
            } catch (e) {
                lastError = e;
                console.warn('[STT] Provider failed, trying next if available:', provider.label, e.message);
            }
        }
        throw lastError || new Error('没有可用的语音识别服务');
    }

    // 读取 / 写入 sessionStorage 缓存（同一会话内不重复调用 API）
    function sttReadCache(src) {
        try { return JSON.parse(sessionStorage.getItem(STT_CACHE_PREFIX + src)); } catch { return null; }
    }
    function sttWriteCache(src, segs) {
        try { sessionStorage.setItem(STT_CACHE_PREFIX + src, JSON.stringify(segs)); } catch {}
    }

    // 获取顶层状态栏
    function sttGetStatusBar(dialogBody) {
        const lyricEl = document.querySelector('.audio-player-lyric');
        // 直接以歌词面板 lyricEl 作为挂载容器，如果不存在则退回到 dialogBody
        // 避免给整个播放器大容器设置 position: relative，从而破坏左侧音频列表的绝对定位和点击层级
        const playerContainer = lyricEl || dialogBody;

        let p = document.getElementById('sj-stt-status');
        if (!p) {
            p = document.createElement('div');
            p.id = 'sj-stt-status';

            // 确保挂载容器为 relative 定位，便于绝对定位
            if (playerContainer && playerContainer !== dialogBody) {
                playerContainer.style.setProperty('position', 'relative', 'important');
            }

            p.style.cssText = [
                'position:absolute',
                'top:12px',
                'right:12px',
                'z-index:2000',
                'background:rgba(9, 13, 22, 0.85)',
                'backdrop-filter:blur(8px)',
                'border:1px solid rgba(255, 255, 255, 0.1)',
                'border-radius:6px',
                'padding:6px 12px',
                'font-family:system-ui,-apple-system,sans-serif',
                'font-size:11px',
                'display:flex',
                'align-items:center',
                'gap:8px',
                'color:#cbd5e1',
                'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
                'pointer-events:auto'
            ].join(';');

            if (playerContainer) {
                playerContainer.appendChild(p);
            } else {
                dialogBody.insertBefore(p, dialogBody.firstChild);
            }
        }
        return p;
    }

    function sttRenderLoading(bar, provider) {
        const providerLabel = provider && provider.label ? provider.label : 'AI';
        bar.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;color:#8b949e;">
                <div style="width:12px;height:12px;border:2px solid #388bfd;border-top-color:transparent;border-radius:50%;animation:sj-stt-spin 0.8s linear infinite;"></div>
                <style>@keyframes sj-stt-spin{to{transform:rotate(360deg)}}</style>
                🤖 ${providerLabel} 正在识别语音...
            </div>`;
    }

    function sttRenderError(bar, msg) {
        bar.innerHTML = `<div style="color:#f85149;">❌ AI识别失败：${msg}</div>`;
    }

    function sttRenderAiToggleButton() {
        const enabled = sttIsAiEnabled();
        return `<button id="sj-stt-ai-toggle" title="${enabled ? '关闭后不再自动调用硅基/Groq' : '开启后允许调用硅基/Groq'}" style="background:${enabled ? '#238636' : '#30363d'};color:#fff;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:11px;white-space:nowrap;">${enabled ? 'AI开' : 'AI关'}</button>`;
    }

    function sttBindAiToggle(bar, audio, dialogBody, rerunAfterEnable = false) {
        const btn = bar.querySelector('#sj-stt-ai-toggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const next = !sttIsAiEnabled();
            sttSetAiEnabled(next);
            if (next) {
                sttProcess(audio, dialogBody, true);
            } else {
                if (audio && audio.src && sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, 'ai-disabled-toggle')) {
                    return;
                }
                sttRenderAiDisabled(bar, audio, dialogBody);
            }
        });
    }

    function sttRenderAiDisabled(bar, audio, dialogBody) {
        bar.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;width:100%;color:#8b949e;">
                <span style="white-space:nowrap;">AI识别关闭，当前只使用原生字幕/缓存</span>
                ${sttRenderAiToggleButton()}
                <button id="sj-stt-ai-enable-now" style="background:#238636;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;white-space:nowrap;">开启并识别</button>
            </div>`;
        
        if (audio && audio.src) {
            sttCurrentOrderTranscripts[audio.src] = [];
            sttUpdateContextualTips();
        }

        sttBindAiToggle(bar, audio, dialogBody, true);
        const enableBtn = bar.querySelector('#sj-stt-ai-enable-now');
        if (enableBtn) {
            enableBtn.addEventListener('click', () => {
                sttSetAiEnabled(true);
                sttProcess(audio, dialogBody);
            });
        }
    }

    function sttRenderKeyPrompt(bar, audio, dialogBody) {
        bar.innerHTML = `
            <div style="display:grid;grid-template-columns:auto minmax(110px,1fr) auto minmax(110px,1fr) auto;align-items:center;gap:6px;width:100%;">
                <span style="color:#d29922;white-space:nowrap;">STT Key</span>
                <input id="sj-stt-sf-key-inp" type="password" placeholder="SiliconFlow sk-...（短音频）" value="${sttGetSiliconFlowKey() ? '********' : ''}" style="background:#161b22;border:1px solid #30363d;border-radius:4px;color:#e6edf3;padding:4px 8px;font-size:12px;outline:none;">
                <span style="color:#6e7681;white-space:nowrap;">+</span>
                <input id="sj-stt-groq-key-inp" type="password" placeholder="Groq gsk_...（长音频）" value="${sttGetGroqKey() ? '********' : ''}" style="background:#161b22;border:1px solid #30363d;border-radius:4px;color:#e6edf3;padding:4px 8px;font-size:12px;outline:none;">
                <button id="sj-stt-key-btn" style="background:#238636;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;white-space:nowrap;">保存并识别</button>
            </div>`;
        bar.querySelector('#sj-stt-key-btn').addEventListener('click', () => {
            const sf = bar.querySelector('#sj-stt-sf-key-inp').value.trim();
            const groq = bar.querySelector('#sj-stt-groq-key-inp').value.trim();
            if (sf && sf !== '********') sttSaveSiliconFlowKey(sf);
            if (groq && groq !== '********') sttSaveGroqKey(groq);
            if (!sttHasAnyProviderKey()) return;
            sttProcess(audio, dialogBody);
        });
    }

    function sttRenderSuccess(bar, dialogBody, segments, audio) {
        const targetInput = findCorrespondingTextarea(audio.src);
        const fillBtnText = targetInput ? '✍️ 填入原框' : '📋 复制文本';

        bar.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex:1;">
                <span style="color:#3fb950; font-weight:bold; white-space:nowrap;">🤖 AI 字幕已就绪</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${sttRenderAiToggleButton()}
                <button id="sj-stt-btn-fill" style="background:#238636; color:#fff; border:none; border-radius:4px; padding:4px 10px; cursor:pointer; font-size:12px; font-weight:bold; display:flex; align-items:center; gap:4px; transition:background 0.2s;">
                    ${fillBtnText}
                </button>
                <button id="sj-stt-cache-clear" title="清除该音频的 AI 识别缓存并重新识别" style="background:none; border:none; color:#f85149; cursor:pointer; font-size:11px; outline:none; font-weight:bold; margin-right:4px;">清除缓存</button>
                <button id="sj-stt-key-clear" title="重新填写 API Key" style="background:none; border:none; color:#6e7681; cursor:pointer; font-size:11px; outline:none;">重置Key</button>
            </div>`;

        const fillBtn = bar.querySelector('#sj-stt-btn-fill');
        const clearBtn = bar.querySelector('#sj-stt-key-clear');
        const clearCacheBtn = bar.querySelector('#sj-stt-cache-clear');
        sttBindAiToggle(bar, audio, dialogBody, false);

        const fullText = segments.map(s => s.text.trim()).join('');
        fillBtn.addEventListener('click', () => {
            const currentTargetInput = findCorrespondingTextarea(audio.src);
            if (currentTargetInput) {
                fillTextarea(currentTargetInput, fullText);
                autoReviewToast('✅ 已成功替换输入框文本！');
            } else {
                navigator.clipboard.writeText(fullText).then(() => {
                    autoReviewToast('⚠️ 未找到输入框，已复制文本到剪贴板！', true);
                }).catch(() => {
                    autoReviewToast('❌ 复制失败，请手动选择文字复制。', true);
                });
            }
        });

        clearBtn.addEventListener('click', () => {
            localStorage.removeItem(STT_KEY_LS);
            localStorage.removeItem(SF_KEY_LS);
            const currentAudio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
            sttRenderKeyPrompt(bar, currentAudio, dialogBody);
        });

        clearCacheBtn.addEventListener('click', () => {
            sessionStorage.removeItem(STT_CACHE_PREFIX + audio.src);
            sessionStorage.removeItem('stt_cache_' + audio.src);
            delete sttCurrentOrderTranscripts[audio.src]; // 清理全局引用
            autoReviewToast('🧹 缓存已清理，正在重新发起 AI 识别...', false);
            sttProcess(audio, dialogBody);
        });

        // 联动更新 Q10 / Q15 面板下方的 AI 线索卡片
        sttCurrentOrderTranscripts[audio.src] = segments;
        sttUpdateContextualTips();
    }

    function sttRenderNativeReuse(bar, dialogBody, segments, audio) {
        sttRestoreNativeSubtitles(audio, segments);
        const analysis = sttAnalyzeBusinessClues(segments, audio && audio.src || 'native://dialog');
        const matchedKinds = [];
        if (analysis.price.length > 0) matchedKinds.push('Q10价格');
        if (analysis.stock.length > 0) matchedKinds.push('Q15库存');
        const statusText = matchedKinds.length > 0
            ? `原生字幕命中：${matchedKinds.join('、')}，未调用AI`
            : '已回退原生字幕；未发现价格/库存线索';
        const statusColor = matchedKinds.length > 0 ? '#3fb950' : '#d29922';
        bar.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; flex:1;">
                <span style="color:${statusColor}; font-weight:bold; white-space:nowrap;">${statusText}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                ${sttRenderAiToggleButton()}
                <button id="sj-stt-force-ai" title="跳过原生字幕，强制调用 AI 重新识别" style="background:#238636;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;font-weight:bold;">强制AI</button>
            </div>`;

        const forceBtn = bar.querySelector('#sj-stt-force-ai');
        sttBindAiToggle(bar, audio, dialogBody, false);
        if (forceBtn) {
            forceBtn.addEventListener('click', () => {
                sttProcess(audio, dialogBody, true);
            });
        }

        sttCurrentOrderTranscripts[audio.src] = segments;
        sttUpdateContextualTips();
    }

    // 解析 SRT 格式时间戳：00:00:01,000 --> 00:00:04,000
    function parseSrtTime(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length < 3) return 0;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const sParts = parts[2].split(',');
        const s = parseInt(sParts[0], 10);
        const ms = sParts.length > 1 ? parseInt(sParts[1], 10) : 0;
        return h * 3600 + m * 60 + s + ms / 1000;
    }

    function sttCoerceTimeSeconds(value) {
        if (Array.isArray(value)) {
            return sttCoerceTimeSeconds(value[0]);
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return NaN;
            if (/^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}$/.test(trimmed)) return parseSrtTime(trimmed.replace('.', ','));
            if (/^\d{1,2}:\d{2}(?:[,.]\d{1,3})?$/.test(trimmed)) {
                const parts = trimmed.replace(',', '.').split(':');
                return Number(parts[0]) * 60 + Number(parts[1]);
            }
        }
        const n = Number(value);
        if (!Number.isFinite(n)) return NaN;
        return n > 10000 ? n / 1000 : n;
    }

    function sttSegmentFromObject(item, fallbackDuration) {
        if (!item || typeof item !== 'object') return null;
        const text = String(
            item.text || item.content || item.sentence || item.transcript || item.word || item.words || ''
        ).trim();
        if (!text) return null;

        const timestamp = item.timestamp || item.timestamps || item.timeRange || item.range;
        let start = sttCoerceTimeSeconds(
            item.start ?? item.start_time ?? item.startTime ?? item.begin ?? item.begin_time ?? item.beginTime ??
            item.from ?? item.offset ?? item.time ?? (Array.isArray(timestamp) ? timestamp[0] : timestamp)
        );
        let end = sttCoerceTimeSeconds(
            item.end ?? item.end_time ?? item.endTime ?? item.finish ?? item.finish_time ?? item.finishTime ??
            item.to ?? (Array.isArray(timestamp) ? timestamp[1] : undefined)
        );
        const duration = sttCoerceTimeSeconds(item.duration ?? item.dur);
        const hasStart = Number.isFinite(start);
        if (!Number.isFinite(start)) start = 0;
        if (!Number.isFinite(end)) {
            end = Number.isFinite(duration) && duration > 0 ? start + duration : (fallbackDuration || start);
        }
        return {
            start,
            end,
            text,
            timeUnreliable: !hasStart
        };
    }

    function parseSrt(srtText) {
        const blocks = srtText.trim().split(/\n\s*\n/);
        const result = [];
        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length >= 3) {
                const timeLine = lines[1];
                const textLine = lines.slice(2).join(' ').trim();
                const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
                if (timeMatch && textLine) {
                    result.push({
                        start: parseSrtTime(timeMatch[1]),
                        end: parseSrtTime(timeMatch[2]),
                        text: textLine
                    });
                }
            }
        }
        return result;
    }

    // 匹配页面上的相应输入框/文本框
    function findCorrespondingTextarea(audioSrc) {
        if (!audioSrc) return null;

        const urlParts = audioSrc.split('/');
        const filename = urlParts[urlParts.length - 1];
        if (!filename) return null;

        const cleanFilename = filename.split('?')[0];

        const reviews = document.querySelectorAll('.answer--review');
        for (const review of reviews) {
            // 1. 检测 audio 元素 src
            const audios = review.querySelectorAll('audio');
            for (const aud of audios) {
                if (aud.src && aud.src.includes(cleanFilename)) {
                    return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
                }
            }

            // 2. 检测 a 链接 href 或内容
            const links = review.querySelectorAll('a');
            for (const link of links) {
                if (link.href && link.href.includes(cleanFilename)) {
                    return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
                }
                if (link.textContent && link.textContent.includes(cleanFilename)) {
                    return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
                }
            }

            // 3. 检测文本内容
            if (review.textContent && review.textContent.includes(cleanFilename)) {
                return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
            }

            // 4. 遍历所有子元素属性进行深度查找
            const allEls = review.querySelectorAll('*');
            for (const el of allEls) {
                for (const attr of el.attributes) {
                    if (attr.value && attr.value.includes(cleanFilename)) {
                        return review.querySelector('textarea, input[type="text"], .el-textarea__inner, .el-input__inner');
                    }
                }
            }
        }
        return null;
    }

    // 填入 Vue 绑定的文本框并触发事件以防丢失响应性
    function fillTextarea(textarea, text) {
        if (!textarea) return false;
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function sttEnsureSentencePunctuation(text) {
        const clean = String(text || '').replace(/[ \t]+/g, ' ').trim();
        if (!clean || /[，。？！；;,.!?]$/.test(clean)) return clean;
        const normalized = sttNormalizeBusinessText(clean);
        const looksLikeQuestion = /请问|多少|几(?:箱|件|块)|有没有|还有吗|吗|么|呢|怎么卖|什么价|贵不贵/.test(normalized);
        return clean + (looksLikeQuestion ? '？' : '。');
    }

    // 将 AI 识别文本按标点拆分为短句；普通空格不是句界，不能据此打碎文本。
    function splitIntoPhrases(text) {
        const rawParts = String(text || '').split(/([，。？！、\n；;]+)/);
        const phrases = [];
        for (let i = 0; i < rawParts.length; i += 2) {
            const words = rawParts[i] || '';
            const punct = rawParts[i + 1] || '';
            const combined = (words + punct).trim();
            if (combined) {
                phrases.push(combined);
            }
        }
        return phrases;
    }

    function sttSegmentsToDisplayPhrases(segments) {
        const phrases = [];
        (segments || []).forEach(seg => {
            const parts = splitIntoPhrases(seg && seg.text || '');
            if (parts.length === 0) return;
            parts.forEach(part => {
                const readable = sttEnsureSentencePunctuation(part);
                if (readable) phrases.push(readable);
            });
        });
        return phrases;
    }

    // 调整切分段落数精确等于原生字幕 li 数量 N
    function adjustSegmentCount(phrases, N) {
        if (phrases.length === 0) {
            return Array(N).fill('');
        }
        let segments = [...phrases];

        // 数量过多：合并长度最短的相邻项
        while (segments.length > N) {
            let bestIdx = 0;
            let minLen = Infinity;
            for (let i = 0; i < segments.length - 1; i++) {
                const combinedLen = segments[i].length + segments[i+1].length;
                if (combinedLen < minLen) {
                    minLen = combinedLen;
                    bestIdx = i;
                }
            }
            const separator = /[，。？！；;,.!?]$/.test(segments[bestIdx]) ? '' : '，';
            segments[bestIdx] = segments[bestIdx] + separator + segments[bestIdx + 1];
            segments.splice(bestIdx + 1, 1);
        }

        // 数量过少时保留模型原始分段，剩余字幕行留空，绝不从句子中间硬切。
        while (segments.length < N) segments.push('');
        return segments;
    }

    let sttObserver = null;
    const sttNativeSubtitleSnapshots = new Map();

    function sttAudioKey(src) {
        try {
            const clean = String(src || '').split('?')[0];
            return clean.substring(clean.lastIndexOf('/') + 1);
        } catch {
            return String(src || '');
        }
    }

    function sttCurrentDialogAudioKey() {
        const audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
        return audio && audio.src ? sttAudioKey(audio.src) : '';
    }

    // 建立 MutationObserver 监听，确保 Vue 重绘时能自动锁定并重写为 AI 字幕
    function observeSubtitles(listItems, aiSegments, sourceSrc) {
        if (sttObserver) {
            sttObserver.disconnect();
            sttObserver = null;
        }

        const targetUl = document.querySelector('.audio-player-lyric ul');
        if (!targetUl) return;
        const sourceKey = sttAudioKey(sourceSrc);

        sttObserver = new MutationObserver(() => {
            if (sourceKey && sttCurrentDialogAudioKey() !== sourceKey) {
                sttObserver.disconnect();
                sttObserver = null;
                return;
            }
            sttObserver.disconnect();

            listItems.forEach((li, idx) => {
                const span = li.querySelector('span');
                const text = aiSegments[idx] || '';
                li.style.display = text.trim() ? '' : 'none';
                if (span && span.textContent !== text) {
                    span.textContent = text;
                }
            });

            sttObserver.observe(targetUl, {
                childList: true,
                characterData: true,
                subtree: true
            });
        });

        sttObserver.observe(targetUl, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    // 替换原文字幕（不影响点击跳转和播放样式，完美融入原生 UI）
    function replaceNativeSubtitles(segments, sourceSrc) {
        const listItems = document.querySelectorAll('.audio-player-lyric ul li');
        if (!listItems || listItems.length === 0) return false;
        const sourceKey = sttAudioKey(sourceSrc);
        if (sourceKey && sttCurrentDialogAudioKey() && sttCurrentDialogAudioKey() !== sourceKey) return false;

        const targetUl = document.querySelector('.audio-player-lyric ul');
        if (sourceKey && targetUl && targetUl.dataset.sjSttMode !== 'ai') {
            const currentAudio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
            const nativeSnapshot = sttGetNativeSubtitleSegments(currentAudio);
            if (nativeSnapshot.length > 0) sttNativeSubtitleSnapshots.set(sourceKey, nativeSnapshot);
        }

        const N = listItems.length;
        // 保留 API 自带的段落/停顿边界；旧逻辑无分隔 join 后再硬切，导致字幕杂乱且无标点。
        const phrases = sttSegmentsToDisplayPhrases(segments);
        const aiSegments = adjustSegmentCount(phrases, N);

        listItems.forEach((li, idx) => {
            const span = li.querySelector('span');
            const text = aiSegments[idx] || '';
            li.style.display = text.trim() ? '' : 'none';
            if (span) {
                span.textContent = text;
            }
        });

        if (targetUl) {
            targetUl.dataset.sjSttSource = sourceKey;
            targetUl.dataset.sjSttMode = 'ai';
        }
        observeSubtitles(listItems, aiSegments, sourceSrc);
        return true;
    }

    function sttGetNativeSubtitleSegments(audio) {
        const currentKey = sttAudioKey(audio && audio.src);
        const targetUl = document.querySelector('.audio-player-lyric ul');
        if (targetUl && targetUl.dataset.sjSttMode === 'ai') {
            return sttNativeSubtitleSnapshots.get(currentKey) || [];
        }
        if (targetUl && targetUl.dataset.sjSttSource) {
            const sourceKey = targetUl.dataset.sjSttSource || '';
            if (sourceKey && currentKey && sourceKey !== currentKey) return [];
        }
        let listItems = Array.from(document.querySelectorAll('.audio-player-lyric ul li, .audio-player-lyric li'));
        if (!listItems || listItems.length === 0) {
            const lyricBox = document.querySelector('.audio-player-lyric');
            const fallbackLines = (lyricBox && lyricBox.innerText || '')
                .split(/\n+/)
                .map(t => t.replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            listItems = fallbackLines.map((text, idx) => ({ textContent: text, dataset: {}, getAttribute: () => '', __fallbackIndex: idx }));
        }
        if (!listItems || listItems.length === 0) return [];

        const duration = Number(audio && audio.duration) || 0;
        const count = listItems.length;
        const segments = [];

        listItems.forEach((li, idx) => {
            const text = (li.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) return;
            const attrTime =
                li.getAttribute('data-time') ||
                li.getAttribute('data-start') ||
                li.getAttribute('data-start-time') ||
                li.getAttribute('data-begin') ||
                li.dataset.time ||
                li.dataset.start ||
                li.dataset.startTime ||
                li.dataset.begin ||
                '';
            let start = sttCoerceTimeSeconds(attrTime);
            const hasNativeTime = Number.isFinite(start);
            if (!Number.isFinite(start)) {
                start = duration > 0 && count > 0 ? duration * idx / count : idx * 3;
            }
            const end = duration > 0 && count > 0 ? duration * (idx + 1) / count : start + 3;
            segments.push({ start, end, text, timeUnreliable: !hasNativeTime });
        });

        return segments;
    }

    function sttRestoreNativeSubtitles(audio, fallbackSegments) {
        const currentKey = sttAudioKey(audio && audio.src);
        const targetUl = document.querySelector('.audio-player-lyric ul');
        const listItems = Array.from(document.querySelectorAll('.audio-player-lyric ul li'));
        if (!targetUl || listItems.length === 0) return false;

        const snapshot = sttNativeSubtitleSnapshots.get(currentKey) || fallbackSegments || [];
        if (!snapshot.length) return false;
        if (sttObserver) {
            sttObserver.disconnect();
            sttObserver = null;
        }

        const restoredLines = snapshot.length === listItems.length
            ? snapshot.map(seg => String(seg.text || '').trim())
            : adjustSegmentCount(sttSegmentsToDisplayPhrases(snapshot), listItems.length);
        listItems.forEach((li, idx) => {
            const text = restoredLines[idx] || '';
            const span = li.querySelector('span');
            li.style.display = text ? '' : 'none';
            if (span) span.textContent = text;
        });
        delete targetUl.dataset.sjSttSource;
        delete targetUl.dataset.sjSttMode;
        return true;
    }

    // 深度搜索 Vue 组件树和 Vuex 状态库，抓取已下载的原生字幕数据（无需弹窗/播放器加载到 DOM）
    function sttFindNativeSubtitlesInVue(audioUrl) {
        if (!audioUrl) return [];
        const audioKey = sttAudioKey(audioUrl); // E.g. "139146_15375271.mp3"
        if (!audioKey) return [];

        const visited = new Set();
        let foundSegs = [];

        function scan(obj, depth = 0) {
            if (!obj || depth > 8 || foundSegs.length > 0) return;
            if (typeof obj !== 'object') return;
            if (visited.has(obj)) return;
            visited.add(obj);

            // 检查当前对象是否包含该音频的标识符
            let hasAudioUrl = false;
            for (const key in obj) {
                try {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        const val = obj[key];
                        if (typeof val === 'string' && val.includes(audioKey)) {
                            hasAudioUrl = true;
                            break;
                        }
                    }
                } catch {}
            }

            // 如果当前对象绑定了该音频，深度检索其同级属性中的文本或段落数据
            if (hasAudioUrl) {
                for (const key in obj) {
                    try {
                        if (Object.prototype.hasOwnProperty.call(obj, key)) {
                            const val = obj[key];
                            // 情况A：字幕以数组段落形式存在
                            if (Array.isArray(val) && val.length > 0) {
                                const first = val[0];
                                if (first && typeof first === 'object' && (first.text || first.content) && /[\u4e00-\u9fa5]/.test(first.text || first.content || '')) {
                                    foundSegs = val.map(item => sttSegmentFromObject(item, 0)).filter(Boolean);
                                    return;
                                }
                            }
                            // 情况B：字幕为单条长文本（过滤 URL 和 CDN 域名）
                            if (typeof val === 'string' && val.length > 10 && /[\u4e00-\u9fa5]/.test(val) && !val.includes('http') && !val.includes('sjaudiopub')) {
                                const fallbackDuration = sttParseDurationFromSrc(audioUrl) || 0;
                                if (val.includes('-->') || val.includes('\n')) {
                                    foundSegs = parseApiResponse(val, fallbackDuration);
                                } else {
                                    foundSegs = [{ start: 0, end: fallbackDuration, text: val.trim(), timeUnreliable: true }];
                                }
                                return;
                            }
                        }
                    } catch {}
                }
            }

            // 递归扫描子属性
            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    scan(obj[i], depth + 1);
                }
            } else {
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        if (key.startsWith('_') && key !== '_data' && key !== '_props') continue;
                        if (['$el', '$parent', '$root', 'constructor', 'sys'].includes(key)) continue;
                        scan(obj[key], depth + 1);
                    }
                }
            }
        }

        // 获取页面所有的 Vue 根实例并开启扫描
        const seedEls = document.querySelectorAll('*');
        const visitedComponents = new Set();
        for (const el of seedEls) {
            if (el.__vue__) {
                let rootVm = el.__vue__;
                while (rootVm.$parent) {
                    rootVm = rootVm.$parent;
                }
                if (visitedComponents.has(rootVm)) continue;
                visitedComponents.add(rootVm);

                function scanVueComponent(vm) {
                    if (!vm) return;
                    scan(vm, 0);
                    if (foundSegs.length > 0) return;
                    
                    if (vm.$store && vm.$store.state) {
                        scan(vm.$store.state, 0);
                        if (foundSegs.length > 0) return;
                    }
                    if (vm.$children && Array.isArray(vm.$children)) {
                        for (const child of vm.$children) {
                            scanVueComponent(child);
                            if (foundSegs.length > 0) return;
                        }
                    }
                }
                scanVueComponent(rootVm);
                if (foundSegs.length > 0) break;
            }
        }

        return foundSegs;
    }

    function sttNativeHasUsefulBusinessSignal(segments) {
        const analysis = sttAnalyzeBusinessClues(segments, 'native://probe');
        return analysis.price.length > 0 || analysis.stock.length > 0;
    }

    function sttTryUseNativeSubtitles(audio, dialogBody, bar, reason) {
        if (!audio || !audio.src) return false;
        const nativeSegs = sttGetNativeSubtitleSegments(audio);
        if (nativeSegs && nativeSegs.length > 0 && sttNativeHasUsefulBusinessSignal(nativeSegs)) {
            console.log(`[STT] Using native subtitles (${reason || 'matched'}), skipping/falling back from AI:`, audio.src);
            sttWriteCache(audio.src, nativeSegs);
            sttRenderNativeReuse(bar, dialogBody, nativeSegs, audio);
            return true;
        }
        return false;
    }

    // 宽松版原生字幕回退：只要有字幕内容就展示，不检查业务信号。
    // 用于 AI 报错 / 幻觉 场景——"展示原生字幕"永远比"显示一条报错"对用户更有帮助。
    function sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, reason) {
        if (!audio || !audio.src) return false;
        const nativeSegs = sttGetNativeSubtitleSegments(audio);
        if (nativeSegs && nativeSegs.length > 0) {
            console.log(`[STT] Lenient native fallback (${reason}), showing native subtitles regardless of business signal:`, audio.src);
            sttWriteCache(audio.src, nativeSegs);
            sttRenderNativeReuse(bar, dialogBody, nativeSegs, audio);
            return true;
        }
        return false;
    }

    async function sttWaitAndUseNativeSubtitles(audio, dialogBody, bar, reason, timeoutMs = 2500) {
        const start = Date.now();
        while (Date.now() - start <= timeoutMs) {
            if (sttTryUseNativeSubtitles(audio, dialogBody, bar, reason)) return true;
            await autoReviewSleep(120);
        }
        return false;
    }

    async function sttWaitAndUseNativeSubtitlesLenient(audio, dialogBody, bar, reason, timeoutMs = 2500) {
        const start = Date.now();
        while (Date.now() - start <= timeoutMs) {
            if (sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, reason)) return true;
            await autoReviewSleep(120);
        }
        return false;
    }

    function sttGetNativeSubtitleSegmentsByUrl(url) {
        if (!url) return [];
        let nativeSegs = [];
        const audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
        if (audio && sttAudioKey(audio.src) === sttAudioKey(url)) {
            nativeSegs = sttGetNativeSubtitleSegments(audio);
        }
        if (!nativeSegs || nativeSegs.length === 0) {
            nativeSegs = sttFindNativeSubtitlesInVue(url);
        }
        return nativeSegs || [];
    }

    function sttTryUseNativeSubtitlesByUrl(url, reason) {
        if (!url) return false;
        const httpsUrl = url.replace(/^http:\/\//i, 'https://');
        const nativeSegs = sttGetNativeSubtitleSegmentsByUrl(url);
        if (nativeSegs && nativeSegs.length > 0 && sttNativeHasUsefulBusinessSignal(nativeSegs)) {
            console.log(`[STT AutoScan] Using native subtitles (${reason || 'matched'}), skipping AI API:`, url);
            sttWriteCache(httpsUrl, nativeSegs);
            sttWriteCache(url, nativeSegs);
            sttCurrentOrderTranscripts[url] = nativeSegs;
            sttUpdateContextualTips();
            return true;
        }
        return false;
    }

    async function sttWaitAndUseNativeSubtitlesByUrl(url, reason, timeoutMs = 2500) {
        const start = Date.now();
        while (Date.now() - start <= timeoutMs) {
            if (sttTryUseNativeSubtitlesByUrl(url, reason)) return true;
            await autoReviewSleep(160);
        }
        return false;
    }

    // 检测是否为 Whisper 底层静音/噪声产生的幻觉段落
    function sttIsHallucination(text) {
        if (!text) return true;
        // 匹配常见的 Whisper 幻觉模式，包含各种点赞、订阅、明镜电视等新闻和YouTube台词
        const regex = /谢谢(收看|观看|订阅|大家|支持)|订阅(频道|我们|转发|打赏)|点赞(订阅|转发|打赏|支持)|点击订阅|阅读订阅|视频被订阅|连续电话|本集完|感谢观看|请不吝|明镜|Amara|字幕(组|志愿者|提供)|网易云|下期(再见|视频)|收看我们|非常感谢|YouTube|Youtube|television|series|terms|Foster|companion|astronom|zwi[a-z]*|全球首发|独播剧场|电视剧|人类拯救|用于我自己的生命|频道|微博.*广告|抢购|会员|医生|玩具|研究室|新增约束|太阳的|表里|新闻|搜索|热搜|保证这张搜索|放在顶部|红色的红色|10月20日|发生火灾|冰沙路|洛杉矶|长沙山市|外国人发现|更好的生活|中央小区|东业务司|蔡工房|迷尿|忠明|记者|黄鹤楼|四绷/i;
        const compact = text.replace(/\s+/g, '');
        if (regex.test(text)) return true;
        const businessNormalized = sttNormalizeBusinessText(text);
        const businessHits = (businessNormalized.match(/脉动|电解质|1L|库存|仓库|现货|整箱|多少钱|价格|价钱|几箱|几件|多少箱|还有货|有没有|\d+\s*(?:箱|件)|[一二三四五六七八九十百两]+(?:箱|件)|元|块/g) || []).length;
        const hasBusinessWord = businessHits > 0;
        const latinMatches = text.match(/[A-Za-z]{2,}/g) || [];
        const latinChars = latinMatches.join('').length;
        const nonCnNoise = text.match(/[ぁ-んァ-ンа-яА-Я�]/g) || [];
        if (!hasBusinessWord && (latinChars >= 10 || nonCnNoise.length >= 2)) {
            return true;
        }
        // 很多短音/静音会被识别成连续的寒暄和无意义口头词，这类不进入业务线索抽取。
        if (compact.length <= 24 && /^(啊|嗯|好|好的|谢谢|你看|不是|可以|走了|对吗|是的|不要去|开始|第一|喂|喂呀)+$/.test(compact)) {
            return true;
        }
        if (!hasBusinessWord && compact.length <= 10 && /^(老板|你好|您好|老公|没事|说案子|代理|新增约束)+$/.test(compact)) {
            return true;
        }
        if (compact.length > 500 && businessHits < 4) return true;
        if (compact.length > 280 && businessHits < 2 && /谢谢|拜拜|记者|妈妈|爸爸|公司|业务|照片|过来|出去/.test(compact)) return true;
        return false;
    }

    // 清理 AI 识别出的文本：去除连续重复句
    function sttCleanText(text) {
        if (!text) return '';
        const rawParts = text.split(/([，。？！、\n；;]+)/);
        const phrases = [];
        for (let i = 0; i < rawParts.length; i += 2) {
            const words = rawParts[i] || '';
            const punct = rawParts[i + 1] || '';
            const combined = (words + punct).trim();
            if (combined) {
                const cleanWord = words.trim();
                // 1. 过滤常见的 Whisper 静音/噪声极短幻觉词（作为双重保险）
                if (sttIsHallucination(cleanWord) || /谢谢(收看|观看|订阅|大家)|订阅(频道|我们)|字幕|Amara|volunteer/i.test(cleanWord)) {
                    continue;
                }
                // 2. 连续重复句去重
                if (phrases.length > 0) {
                    const prevPhrase = phrases[phrases.length - 1];
                    const prevClean = prevPhrase.replace(/[，。？！、\s\n；;]+/g, '').trim();
                    const currClean = cleanWord.replace(/[，。？！、\s\n；;]+/g, '').trim();
                    if (prevClean && currClean && prevClean === currClean) {
                        continue;
                    }
                }
                phrases.push(combined);
            }
        }
        return phrases.join('');
    }

    function sttEscapeHtml(text) {
        return String(text || '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[ch]);
    }

    function sttFormatTime(seconds) {
        const s = Math.max(0, Math.floor(Number(seconds) || 0));
        const m = Math.floor(s / 60);
        const sec = String(s % 60).padStart(2, '0');
        return `${m}:${sec}`;
    }

    // 把常见谐音/错字先归一成业务词，再做 Q10/Q15 判断。
    function sttNormalizeBusinessText(text) {
        let t = String(text || '');
        const rules = [
            [/卖动|麦动|麦豆|脉豆|迈动|脉懂|脉东|脉董|脉冻|脉通|脉同|买动|脉洞|故划通|故划|麦通/g, '脉动'],
            [/电解字|电解值|电解至|电解纸|电解制|电解智|电解子|电解汁|电解植|长烦|长瓶|电解/g, '电解质'],
            [/医生(?=.{0,10}(?:多少钱|价格|价钱|几块|块|元))/g, '1L'],
            [/(多少钱|价格|价钱|几块|\d+(?:\.\d+)?(?:块|元)).{0,10}医生/g, '$1 1L'],
            [/(?:一生|一身)(?=.{0,10}(?:多少钱|价格|价钱|几块|块|元))/g, '1L'],
            [/一\s*[lL]|1\s*[lL]|一升|1升|大瓶子|大瓶的|大平|大品|大屏|大瓶装/g, '1L'],
            [/一起见货|一其见货|一齐见货/g, '一共几件货'],
            [/见货|现获/g, '现货'],
            [/库村|库层|库纯|库存在|存货|存库|库有|还有整箱|有整箱|整箱的吗|整箱吗/g, '库存整箱'],
            [/有木有|有么有|有没有货|还有货吗|还有没有货/g, '有没有'],
            [/多钱|几块钱|几块|多少一瓶|多少钱一瓶|售价/g, '多少钱'],
            [/那洒|那啥|那个啥/g, '那个']
        ];
        rules.forEach(([from, to]) => {
            t = t.replace(from, to);
        });
        return t;
    }

    function sttHasUsefulBusinessSignal(segments) {
        const text = (segments || []).map(s => s.text || '').join('');
        const normalized = sttNormalizeBusinessText(text);
        const businessHits = (normalized.match(/脉动|电解质|1L|库存|仓库|现货|整箱|多少钱|价格|几箱|几件|还有货|\d+\s*(?:箱|件)|[一二三四五六七八九十百两]+(?:箱|件)|元|块/g) || []).length;
        const junkHits = (text.match(/新闻|订阅|广告|YouTube|terms|companion|astronom|大阪|中国.*美食|洛杉矶|火灾|投票|pseud|firstly|黄蕉|苏都市|小菜店|食物店|网络订阅|故事|妈妈|爸爸|医生|客户|利益|费用|汽车|药方|计算机|克罗|创业网站|欢迎加入|每个人都能通过|东业务司|蔡工房|迷尿|忠明|记者|黄鹤楼|四绷/g) || []).length;
        const latinChars = ((text.match(/[A-Za-z]{2,}/g) || []).join('')).length;
        const textLen = text.replace(/\s+/g, '').length;
        const hasProduct = /脉动|电解质|1L/.test(normalized);
        const hasBusinessQuestion = /库存|仓库|现货|整箱|多少钱|价格|几箱|几件|还有货|有没有|\d+\s*(?:箱|件)|[一二三四五六七八九十百两]+(?:箱|件)|元|块/.test(normalized);
        // 单独出现“块/元”等普通词不能证明 AI 识别正确，必须同时有产品主题和价格/库存意图。
        if (!hasProduct || !hasBusinessQuestion) return false;
        if (junkHits >= 2) return false;
        if (latinChars >= 20) return false;
        if (textLen > 120 && businessHits === 0) return false;
        if (textLen > 500 && businessHits < 4) return false;
        if (textLen > 280 && businessHits < 2) return false;
        if (businessHits >= 2) return true;
        if (businessHits >= 1 && junkHits <= 1 && latinChars < 12) return true;
        return false;
    }

    function sttSplitSentencesWithTime(seg) {
        const text = (seg && seg.text || '').trim();
        if (!text) return [];
        const parts = text.match(/[^，。！？；;,.!?]+[，。！？；;,.!?]?/g) || [text];
        const start = Number(seg.start) || 0;
        const end = Number(seg.end) || start;
        const duration = Math.max(0, end - start);
        const hasReliableTime = !seg.timeUnreliable && Number.isFinite(Number(seg.start));
        const hasEstimatedTime = !!seg.timeUnreliable && duration > 0 && parts.length > 1;
        return parts.map((raw, idx) => {
            const partStart = parts.length > 1 ? start + duration * idx / parts.length : start;
            const partEnd = parts.length > 1 ? start + duration * (idx + 1) / parts.length : end;
            return {
                raw: raw.trim(),
                normalized: sttNormalizeBusinessText(raw.trim()),
                start: partStart,
                end: partEnd,
                hasReliableTime,
                hasEstimatedTime
            };
        }).filter(item => item.raw);
    }

    function sttIsLikelyBusinessAnswer(kind, item) {
        if (!item || !item.raw || sttIsHallucination(item.raw)) return false;
        const normalized = item.normalized || sttNormalizeBusinessText(item.raw);
        const compact = normalized.replace(/[，。？！、\s\n；;,.!?]+/g, '');
        if (compact.length < 1) return false;

        if (/不知道|不清楚|不晓得|没问|没数|没盘|没看|记不清|说不准|忘了|没说/.test(normalized)) return true;
        if (kind === 'price') {
            return /\d+(?:\.\d+)?\s*(?:元|块|毛|角)|[一二三四五六七八九十百两半]+(?:元|块|毛|角)|(?:卖|售价|价格|价钱|一瓶|一件).{0,8}\d/.test(normalized);
        }
        return /\d+(?:\.\d+)?\s*(?:箱|件|瓶|提)|[一二三四五六七八九十百两半]+(?:箱|件|瓶|提)|有货|有的|还有|还有些|没有|没货|没了|卖完|断货|缺货|零箱|一箱都没/.test(normalized);
    }

    function sttCollectFollowingAnswers(kind, items, questionIndex) {
        const question = items[questionIndex];
        if (!question) return [];
        const answers = [];
        // 只检查同一录音紧随问题的两句，避免把下一段录音或远处无关数字拼进来。
        for (let offset = 1; offset <= 2; offset++) {
            const candidate = items[questionIndex + offset];
            if (!candidate || candidate.audioUrl !== question.audioUrl) break;
            if (sttIsLikelyBusinessAnswer(kind, candidate)) answers.push(candidate);
        }
        return answers;
    }

    function sttBuildBusinessClues(kind, transcripts = sttCurrentOrderTranscripts) {
        const items = [];
        for (const audioUrl in transcripts) {
            const segs = transcripts[audioUrl];
            if (!Array.isArray(segs)) continue;
            segs.forEach(seg => {
                sttSplitSentencesWithTime(seg).forEach(item => {
                    item.audioUrl = audioUrl;
                    items.push(item);
                });
            });
        }

        const clues = [];
        const seen = new Set();
        const brandRe = /脉动/;
        const sizeRe = /1L|1升|一升|大瓶/;
        const electrolyteRe = /电解质/;
        const priceRe = /价格|多少钱|几块|块钱|售价|多少一|贵不贵|元一瓶|\d+(?:\.\d+)?\s*(元|块|毛|角)/;
        const stockRe = /库存|仓库|现货|整箱|有整箱|还有整箱|几箱|几件|多少箱|还有没有|有没有货|还有货|还有多少|有多少箱|剩多少|卖完|断货|进货|\d+\s*(?:箱|件)|[一二三四五六七八九十百两]+(?:箱|件)|箱/;

        items.forEach((item, idx) => {
            if (sttIsHallucination(item.raw)) return;
            const prev = items[idx - 1];
            const next = items[idx + 1];
            const context = [prev, item, next].filter(x => x && x.audioUrl === item.audioUrl);
            const contextNorm = context.map(x => x.normalized).join(' ');
            const currentNorm = item.normalized;
            const compact = currentNorm.replace(/[，。？！、\s\n；;,.!?]+/g, '');
            if (compact.length < 2) return;

            const hasBrand = brandRe.test(contextNorm);
            const hasSize = sizeRe.test(contextNorm);
            const hasElectrolyte = electrolyteRe.test(contextNorm);
            const hasPrice = priceRe.test(contextNorm);
            const hasStock = stockRe.test(contextNorm);
            const hasPriceCurrent = priceRe.test(currentNorm);
            const hasStockCurrent = stockRe.test(currentNorm);
            const hasExplicitPriceCurrent = /价格|售价|元|块|毛|角|几块|块钱/.test(currentNorm);
            const hasProductCurrent = brandRe.test(currentNorm) || sizeRe.test(currentNorm) || electrolyteRe.test(currentNorm);
            const isInventoryQuestionCurrent = /(库存|整箱|还有|剩|几箱|多少箱|有没有货|有整箱)/.test(currentNorm);
            const isBareHowMuchInventory = isInventoryQuestionCurrent && /多少钱|多少/.test(currentNorm) && !hasExplicitPriceCurrent && !hasProductCurrent;
            const priceCandidateCurrent = hasPriceCurrent && !isBareHowMuchInventory;
            const isPriceQuestionCurrent = priceCandidateCurrent && /多少|几块|贵不贵|怎么卖|什么价|问.{0,4}(价格|价钱)|吗|么|呢|？/.test(currentNorm);
            const isStockQuestionCurrent = hasStockCurrent && /几箱|几件|多少箱|多少件|有没有|还有多少|剩多少|有多少|一共|问.{0,8}(库存|仓库|现货|箱|件)|吗|么|呢|？/.test(currentNorm);

            let confidence = '';
            let reason = '';
            if (kind === 'price') {
                if (priceCandidateCurrent && hasBrand && (hasSize || hasElectrolyte) && (!hasStockCurrent || hasExplicitPriceCurrent || hasProductCurrent)) {
                    confidence = '高';
                    reason = '命中 脉动 + 1L/电解质 + 价格';
                } else if (priceCandidateCurrent && (hasBrand || hasSize || hasElectrolyte) && (!hasStockCurrent || hasExplicitPriceCurrent || hasProductCurrent)) {
                    confidence = '中';
                    reason = '命中 价格 + 脉动/1L/电解质';
                } else if ((sizeRe.test(currentNorm) || electrolyteRe.test(currentNorm) || (hasBrand && (hasSize || hasElectrolyte))) && !hasStockCurrent) {
                    confidence = '低';
                    reason = '疑似 Q10 产品段，未听清价格词';
                } else if (priceCandidateCurrent && !hasStockCurrent) {
                    confidence = '低';
                    reason = '仅命中价格问法';
                }
            } else {
                if (hasStockCurrent && hasBrand) {
                    confidence = '高';
                    reason = '命中 脉动 + 库存/箱数';
                } else if (hasStockCurrent) {
                    confidence = '中';
                    reason = '命中 库存/箱数问法';
                }
            }
            if (!confidence) return;

            const key = `${kind}-${compact}-${Math.round(item.start)}`;
            if (seen.has(key)) return;
            seen.add(key);

            const isQuestion = kind === 'price' ? isPriceQuestionCurrent : isStockQuestionCurrent;
            const answers = isQuestion ? sttCollectFollowingAnswers(kind, items, idx) : [];
            clues.push({
                confidence,
                reason,
                start: item.start,
                end: item.end,
                hasReliableTime: item.hasReliableTime,
                hasEstimatedTime: item.hasEstimatedTime,
                raw: item.raw,
                normalized: currentNorm,
                context: context.map(x => x.raw),
                answers: answers.map(answer => ({
                    raw: answer.raw,
                    normalized: answer.normalized,
                    start: answer.start,
                    end: answer.end
                })),
                audioUrl: item.audioUrl
            });
        });

        const rank = { '高': 3, '中': 2, '低': 1 };
        return clues
            .sort((a, b) => (rank[b.confidence] - rank[a.confidence]) || (a.start - b.start))
            .slice(0, 2);
    }

    function sttAnalyzeBusinessClues(segments, audioUrl = 'native://probe') {
        const transcripts = { [audioUrl]: Array.isArray(segments) ? segments : [] };
        return {
            price: sttBuildBusinessClues('price', transcripts),
            stock: sttBuildBusinessClues('stock', transcripts)
        };
    }

    function sttFormatBusinessClues(kind, clues) {
        const color = kind === 'price' ? '#facc15' : '#c084fc';
        const bg = kind === 'price' ? 'rgba(234, 179, 8, 0.10)' : 'rgba(168, 85, 247, 0.10)';
        if (!clues || clues.length === 0) {
            return `<div style="color:#6b7280;font-style:italic;">未发现明显${kind === 'price' ? '价格/1L/电解质' : '库存/箱数'}线索，建议人工扫听。</div>`;
        }
        return clues.map(clue => {
            const normalizedText = clue.normalized === clue.raw ? '' : ` | ${clue.normalized}`;
            const title = [
                `原句：${clue.raw}`,
                normalizedText ? `归一化：${clue.normalized}` : '',
                `原因：${clue.reason}`,
                clue.context.length > 1 ? `上下文：${clue.context.join(' / ')}` : '',
                clue.answers && clue.answers.length ? `后续回答：${clue.answers.map(x => x.raw).join(' / ')}` : ''
            ].filter(Boolean).join('\n');
            const questionText = sttEscapeHtml((clue.normalized || clue.raw).replace(/\s+/g, ' '));
            const answerText = clue.answers && clue.answers.length
                ? clue.answers.map(answer => sttEscapeHtml((answer.normalized || answer.raw).replace(/\s+/g, ' '))).join(' / ')
                : '';
            const lineText = answerText
                ? `<span style="color:#64748b;font-weight:600;">问：</span>${questionText}<span style="color:#64748b;font-weight:600;margin-left:6px;">答：</span>${answerText}`
                : questionText;
            const canSeek = clue.hasReliableTime || clue.hasEstimatedTime;
            const timeTitle = clue.hasEstimatedTime ? '按整段文本和音频时长估算的位置，可用于粗略跳转' : '跳到该字幕附近播放';
            const timeLabel = clue.hasEstimatedTime ? `约${sttFormatTime(clue.start)}` : sttFormatTime(clue.start);
            const timeButton = canSeek
                ? `<button class="sj-stt-seek-btn" title="${timeTitle}" data-time="${Math.max(0, clue.start - 2).toFixed(1)}" data-audio="${sttEscapeHtml(clue.audioUrl || '')}" style="background:rgba(15,23,42,0.08);border:1px solid rgba(15,23,42,0.12);border-radius:3px;color:#475569;font-size:10px;padding:0 4px;cursor:pointer;white-space:nowrap;line-height:16px;">${timeLabel}</button>`
                : `<span title="该线索来自无逐句时间戳的文本，无法精确跳转" style="background:rgba(15,23,42,0.05);border:1px solid rgba(15,23,42,0.08);border-radius:3px;color:#94a3b8;font-size:10px;padding:0 4px;white-space:nowrap;line-height:16px;">无时间</span>`;
            return `
                <div class="sj-stt-clue-card" title="${sttEscapeHtml(title)}" style="display:flex;align-items:flex-start;gap:5px;background:${bg};border-left:2px solid ${color};border-radius:3px;padding:3px 5px;margin-top:2px;min-height:18px;max-width:100%;">
                    <span style="color:${color};font-weight:700;white-space:nowrap;font-size:10.5px;line-height:18px;">${clue.confidence}</span>
                    <span style="color:#475569;flex:1;white-space:normal;overflow-wrap:anywhere;line-height:18px;">${lineText}</span>
                    ${timeButton}
                </div>
            `;
        }).join('');
    }

    function sttBindClueSeekButtons(container) {
        if (!container || container.dataset.sjSeekBound === 'true') return;
        container.dataset.sjSeekBound = 'true';
        container.addEventListener('click', async (e) => {
            const btn = e.target.closest('.sj-stt-seek-btn');
            if (!btn) return;
            let audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio, audio');
            if (!audio) {
                const targetUrl = btn.dataset.audio || '';
                const cleanName = targetUrl.split('/').pop().split('?')[0];
                const audioLinks = Array.from(document.querySelectorAll('a[href*=".mp3"], a[href*=".m4a"], a[href*=".wav"], a[href*="sjaudiopub.slicejobs.com"]'));
                const link = audioLinks.find(a => cleanName && (a.href.includes(cleanName) || a.textContent.includes(cleanName))) || audioLinks[0];
                if (link) {
                    autoReviewClickEl(link);
                    for (let i = 0; i < 80; i++) {
                        await autoReviewSleep(50);
                        audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio, audio');
                        if (audio) break;
                    }
                }
            }
            if (!audio) {
                autoReviewToast('未找到音频播放器，也没找到可点击的音频链接', true);
                return;
            }
            const targetTime = parseFloat(btn.dataset.time || '0');
            audio.currentTime = Math.max(0, targetTime);
            audio.play().catch(() => {});
        });
    }

    // 智能解析 API 返回结果，支持 JSON 文本、SRT 字幕和纯文本格式，并自动进行清洗
    function parseApiResponse(result, duration) {
        if (!result) return [];
        const trimmed = result.trim();
        if (!trimmed) return [];

        let rawSegs = [];
        // 1. 如果是 JSON 格式 (SiliconFlow 或 Groq 接口返回通常是 {"text": "..."})
        if (trimmed.startsWith('{')) {
            try {
                const data = JSON.parse(trimmed);
                if (data.segments && Array.isArray(data.segments)) {
                    rawSegs = data.segments.map(s => sttSegmentFromObject(s, duration)).filter(Boolean);
                } else if (data.chunks && Array.isArray(data.chunks)) {
                    rawSegs = data.chunks.map(s => sttSegmentFromObject(s, duration)).filter(Boolean);
                } else if (data.words && Array.isArray(data.words)) {
                    rawSegs = data.words.map(s => sttSegmentFromObject(s, duration)).filter(Boolean);
                } else if (data.text) {
                    rawSegs = [{ start: 0, end: duration || 0, text: data.text.trim(), timeUnreliable: true }];
                }
            } catch (e) {
                console.warn('[STT] Failed to parse API result as JSON:', e);
            }
        }
        // 2. 如果包含 SRT 特征，尝试作为 SRT 解析
        else if (trimmed.includes('-->')) {
            const srtSegs = parseSrt(trimmed);
            if (srtSegs && srtSegs.length > 0) {
                rawSegs = srtSegs;
            }
        }
        // 3. 回退为纯文本格式
        else {
            rawSegs = [{ start: 0, end: duration || 0, text: trimmed, timeUnreliable: true }];
        }

        // 统一对所有段落进行文本清理与去噪
        const cleanedSegs = [];
        for (const seg of rawSegs) {
            const txt = seg.text.trim();
            if (!txt) continue;

            // 过滤幻觉段落
            if (sttIsHallucination(txt)) {
                console.log('[STT] 过滤整个幻觉段落:', txt);
                continue;
            }

            // 连续重复段落去重
            if (cleanedSegs.length > 0) {
                const prevTxt = cleanedSegs[cleanedSegs.length - 1].text.trim();
                const prevClean = prevTxt.replace(/[，。？！、\s\n；;]+/g, '');
                const currClean = txt.replace(/[，。？！、\s\n；;]+/g, '');
                if (prevClean === currClean) {
                    console.log('[STT] 过滤重复段落:', txt);
                    continue;
                }
            }

            // 清洗段落内可能存在的极短噪声
            const cleanedText = sttCleanText(txt);
            if (cleanedText) {
                cleanedSegs.push({
                    ...seg,
                    text: sttEnsureSentencePunctuation(cleanedText)
                });
            }
        }
        return cleanedSegs;
    }

    async function sttProcess(audio, dialogBody, forceAi) {
        const src = audio && audio.src;
        if (!src) return;

        const bar = sttGetStatusBar(dialogBody);

        if (!forceAi && !sttIsAiEnabled()) {
            if (await sttWaitAndUseNativeSubtitlesLenient(audio, dialogBody, bar, 'ai-disabled-lenient')) return;
            sttRenderAiDisabled(bar, audio, dialogBody);
            return;
        }

        if (!forceAi) {
            if (await sttWaitAndUseNativeSubtitles(audio, dialogBody, bar, 'before-ai')) return;
        }

        // 原生字幕必须先于历史 AI 缓存判断，避免旧的错误 AI 字幕抢先覆盖页面字幕。
        const cached = (!forceAi && !sttIsAiEnabled()) ? null : sttReadCache(src);
        if (cached) {
            if (sttHasUsefulBusinessSignal(cached)) {
                replaceNativeSubtitles(cached, src);
                sttRenderSuccess(bar, dialogBody, cached, audio);
                return;
            }
            sessionStorage.removeItem(STT_CACHE_PREFIX + src);
            console.warn('[STT] Cached transcript looks unreliable, clearing and retrying:', src);
        }

        if (!sttHasAnyProviderKey()) { sttRenderKeyPrompt(bar, audio, dialogBody); return; }

        try {
            const arrayBuffer = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: src,
                    responseType: 'arraybuffer',
                    onload:  r => resolve(r.response),
                    onerror: reject,
                    ontimeout: reject
                });
            });

            const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
            const providers = sttChooseProviders(audio, blob, src);
            if (providers.length === 0) { sttRenderKeyPrompt(bar, audio, dialogBody); return; }

            console.log('[STT] Providers:', providers.map(p => p.label).join(' -> '), 'audio size:', (blob.size / 1024 / 1024).toFixed(2), 'MB', 'duration:', audio.duration || sttParseDurationFromSrc(src) || 0);
            const result = await sttTranscribeWithFallback(providers, blob, (provider) => {
                sttRenderLoading(bar, provider);
            });

            // 接口返回后重新检查 AI 开关状态，若已被用户关闭则直接丢弃
            if (!sttIsAiEnabled()) {
                console.log('[STT] AI was disabled mid-flight, discarding results.');
                if (sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, 'ai-disabled-midflight')) return;
                sttRenderAiDisabled(bar, audio, dialogBody);
                return;
            }

            const audioDuration = Number(audio.duration) || sttParseDurationFromSrc(src) || 0;
            let segs = parseApiResponse(result, audioDuration);
            if (!segs || segs.length === 0) {
                segs = [{ start: 0, end: audioDuration, text: '(未识别出有效语音)', timeUnreliable: true }];
            }

            if (sttHasUsefulBusinessSignal(segs)) {
                sttWriteCache(src, segs);
                replaceNativeSubtitles(segs, src);
                sttRenderSuccess(bar, dialogBody, segs, audio);
            } else {
                // AI结果无业务信号：先严格匹配原生字幕，再宽松兜底（有字幕就展示），最后才报错
                if (sttTryUseNativeSubtitles(audio, dialogBody, bar, 'ai-no-business-signal')) return;
                if (sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, 'ai-hallucination-lenient')) return;
                sttRenderError(bar, 'AI结果疑似幻觉，未缓存。建议听原音或稍后重试。');
            }

        } catch (e) {
            console.error('[STT]', e);
            // AI报错：先严格匹配原生字幕，再宽松兜底（有字幕就展示，比报错好）
            if (sttTryUseNativeSubtitles(audio, dialogBody, bar, 'ai-error')) return;
            if (sttTryUseNativeSubtitlesFallback(audio, dialogBody, bar, 'ai-error-lenient')) return;
            sttRenderError(bar, e.message);
        }
    }
    function sttFindContextPanels() {
        const reviews = document.querySelectorAll('.answer--review');
        let q10Panel = null;
        let q15Panel = null;

        for (const review of reviews) {
            let searchText = '';
            let temp = review;
            for (let i = 0; i < 4; i++) {
                if (temp) {
                    searchText += ' ' + (temp.textContent || '');
                    temp = temp.parentElement;
                }
            }

            const hasQ10 = searchText.includes('Q10') || searchText.includes('q10');
            const hasQ15 = searchText.includes('Q15') || searchText.includes('q15');
            if (hasQ10 && !q10Panel) q10Panel = review;
            if (hasQ15 && !q15Panel) q15Panel = review;
        }

        return { q10Panel, q15Panel };
    }

    function sttRenderContextTipBox(panel, id, title, htmlContent) {
        if (!panel) return;
        try {
            let tipBox = panel.querySelector('#' + id);
            if (!tipBox) {
                tipBox = document.createElement('div');
                tipBox.id = id;
                tipBox.className = 'sj-stt-tip-box';
                const insertionTarget = panel.querySelector('textarea, input, .el-textarea, .el-input, .answer-input, .el-form-item') || panel;
                if (insertionTarget && insertionTarget !== panel) {
                    insertionTarget.parentNode.insertBefore(tipBox, insertionTarget);
                } else {
                    panel.appendChild(tipBox);
                }
            }
            tipBox.innerHTML = `<span style="color:#64748b;font-weight:600;font-size:11px;">${title}</span>${htmlContent}`;
            sttBindClueSeekButtons(tipBox);
        } catch (err) {
            console.error('[STT] Error rendering tip box:', err);
        }
    }

    function sttRenderContextStatus(message) {
        const { q10Panel, q15Panel } = sttFindContextPanels();
        const html = `<div style="color:#64748b;font-size:11px;margin-top:2px;">${sttEscapeHtml(message)}</div>`;
        sttRenderContextTipBox(q10Panel, 'sj-stt-tip-q10', 'AI价格:', html);
        sttRenderContextTipBox(q15Panel, 'sj-stt-tip-q15', 'AI库存:', html);
    }

    // 联动渲染 Q10 与 Q15 下方的 AI 字幕重点提示卡片
    function sttUpdateContextualTips() {
        // 确保至少有一个转写成功的音频内容，否则暂不渲染
        let hasAnyTranscripts = false;
        for (const url in sttCurrentOrderTranscripts) {
            const segs = sttCurrentOrderTranscripts[url];
            if (segs && segs.length > 0) {
                hasAnyTranscripts = true;
                break;
            }
        }
        if (!hasAnyTranscripts) return;

        const { q10Panel, q15Panel } = sttFindContextPanels();

        // 如果面板尚未被 Vue 绘制出来，则跳过本次，等待轮询
        if (!q10Panel && !q15Panel) return;

        const priceClues = sttBuildBusinessClues('price');
        const stockClues = sttBuildBusinessClues('stock');
        const highlightedPriceHtml = sttFormatBusinessClues('price', priceClues);
        const highlightedStockHtml = sttFormatBusinessClues('stock', stockClues);

        sttRenderContextTipBox(q10Panel, 'sj-stt-tip-q10', '字幕价格:', highlightedPriceHtml);
        sttRenderContextTipBox(q15Panel, 'sj-stt-tip-q15', '字幕库存:', highlightedStockHtml);
    }

    // 清空两个提示面板
    function sttClearContextualTips() {
        const t1 = document.getElementById('sj-stt-tip-q10');
        if (t1) t1.remove();
        const t2 = document.getElementById('sj-stt-tip-q15');
        if (t2) t2.remove();
    }

    // 从审单页面（不依赖弹窗打开）收集所有音频文件 URL
    // 策略：使用递归对象扫描器深挖 Vue 实例、props、Vuex 状态以及组件树，彻底避免 JSON.stringify 循环引用报错
    function sttCollectAudioUrls() {
        const urls = new Set();
        const AUDIO_CDN_RE = /https?:\/\/sjaudiopub\.slicejobs\.com\/[^"'\s<>\\\]]+/g;

        // 1. 标准 DOM 选择器（做个兜底）
        document.querySelectorAll('audio[src], audio source[src]').forEach(el => {
            if (el.src) urls.add(el.src);
        });
        document.querySelectorAll('a[href]').forEach(el => {
            if (/\.(mp3|m4a|wav|aac)(\?|$)/i.test(el.href)) urls.add(el.href);
        });

        // 2. 深度且安全的 JS 对象属性扫描器（规避 circular reference 循环引用导致的 JSON.stringify 崩溃）
        function safeScanObject(obj, visited = new Set(), depth = 0) {
            if (!obj || depth > 8) return;
            if (typeof obj === 'string') {
                if (obj.includes('sjaudiopub.slicejobs.com')) {
                    const matches = obj.match(AUDIO_CDN_RE);
                    if (matches) {
                        matches.forEach(u => {
                            urls.add(u.replace(/[\\]+$/, '').split('"')[0]);
                        });
                    }
                }
                return;
            }
            if (typeof obj !== 'object') return;
            if (visited.has(obj)) return;
            visited.add(obj);

            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    safeScanObject(obj[i], visited, depth + 1);
                }
                return;
            }

            try {
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        if (key.startsWith('_') && key !== '_data' && key !== '_props') continue;
                        if (['$el', '$parent', '$root', 'constructor', 'sys'].includes(key)) continue;
                        safeScanObject(obj[key], visited, depth + 1);
                    }
                }
            } catch {}
        }

        // 3. 递归扫描 Vue 组件树
        function scanVueComponent(vm, visitedComponents = new Set(), visitedObjects = new Set()) {
            if (!vm || visitedComponents.has(vm)) return;
            visitedComponents.add(vm);

            // 扫描当前组件实例的成员（自动扫描 $data, _data, _props 等）
            safeScanObject(vm, visitedObjects, 0);

            // 扫描 Vuex store state (如果挂载在当前组件或根组件上)
            if (vm.$store && vm.$store.state) {
                safeScanObject(vm.$store.state, visitedObjects, 0);
            }

            // 递归扫描子组件
            if (vm.$children && Array.isArray(vm.$children)) {
                for (const child of vm.$children) {
                    scanVueComponent(child, visitedComponents, visitedObjects);
                }
            }
        }

        // 4. 获取页面中所有 Vue 实例并进行深度扫描
        const visitedComponents = new Set();
        const visitedObjects = new Set();

        const seedEls = document.querySelectorAll('*');
        for (const el of seedEls) {
            if (el.__vue__) {
                let rootVm = el.__vue__;
                while (rootVm.$parent) {
                    rootVm = rootVm.$parent;
                }
                scanVueComponent(rootVm, visitedComponents, visitedObjects);
            }
        }

        // 5. 兜底：innerHTML 全文匹配
        try {
            const raw = document.documentElement.innerHTML;
            (raw.match(AUDIO_CDN_RE) || []).forEach(u => {
                urls.add(u.replace(/["'\\<>]+.*$/, ''));
            });
        } catch {}

        const result = Array.from(urls).filter(u => u.startsWith('http'));
        console.log('[STT AutoScan] Deep collected audio URLs:', result);
        return result;
    }

    // 后台静默下载 + API 识别某个 URL，并把结果写入缓存并更新 Q10/Q15 提示卡片
    const sttSilentInFlight = new Set();
    async function sttSilentProcess(url) {
        if (!url) return;

        const httpsUrl = url.replace(/^http:\/\//i, 'https://');
        // 后台只有在确实拿到原生字幕后才有资格判断是否需要 AI。
        // 如果字幕尚未加载（常见于录音弹窗还没打开），就延后到前台 sttProcess，不能把“没抓到”当成“没关键词”。
        if (await sttWaitAndUseNativeSubtitlesByUrl(url, 'before-background-ai')) return;
        const availableNativeSegs = sttGetNativeSubtitleSegmentsByUrl(url);
        if (!availableNativeSegs || availableNativeSegs.length === 0) {
            console.log('[STT AutoScan] Native subtitles are not available yet; deferring AI until the audio dialog is opened:', url);
            return;
        }

        const cached = sttReadCache(httpsUrl) || sttReadCache(url);
        if (cached) {
            if (sttHasUsefulBusinessSignal(cached)) {
                sttCurrentOrderTranscripts[url] = cached;
                sttUpdateContextualTips();
                return;
            } else {
                sessionStorage.removeItem(STT_CACHE_PREFIX + httpsUrl);
                sessionStorage.removeItem(STT_CACHE_PREFIX + url);
            }
        }

        if (!sttIsAiEnabled()) return;
        if (!sttHasAnyProviderKey()) return;
        if (sttSilentInFlight.has(httpsUrl)) return;

        sttSilentInFlight.add(httpsUrl);
        try {
            const arrayBuffer = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: httpsUrl,
                    responseType: 'arraybuffer',
                    onload:  r => resolve(r.response),
                    onerror: reject,
                    ontimeout: reject
                });
            });

            const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
            const duration = await sttGetAudioDurationFromBlob(blob);
            console.log('[STT AutoScan] 真实音频时长:', duration.toFixed(1), '秒');
            const providers = sttChooseProviders({ duration }, blob, url);
            if (providers.length === 0) return;

            console.log('[STT AutoScan] Providers:', providers.map(p => p.label).join(' -> '), 'audio size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
            sttRenderContextStatus(`AI后台识别中：${providers.map(p => p.label).join(' -> ')}`);
            const result = await sttTranscribeWithFallback(providers, blob, (provider) => {
                sttRenderContextStatus(`AI后台识别中：${provider.label}`);
            });

            const transcriptDuration = duration || sttParseDurationFromSrc(url) || 0;
            let segs = parseApiResponse(result, transcriptDuration);
            if (!segs || segs.length === 0) {
                segs = [{ start: 0, end: transcriptDuration, text: '(未识别出有效语音)', timeUnreliable: true }];
            }

            if (sttHasUsefulBusinessSignal(segs)) {
                sttWriteCache(httpsUrl, segs);
                sttWriteCache(url, segs);
                sttCurrentOrderTranscripts[url] = segs;
                sttUpdateContextualTips();
            } else {
                if (sttTryUseNativeSubtitlesByUrl(url, 'background-ai-no-business-signal')) return;
                sttRenderContextStatus('AI已识别，但未发现可靠的价格/库存线索');
                console.warn('[STT AutoScan] AI result looks unreliable, not caching:', url);
            }
        } catch (e) {
            if (sttTryUseNativeSubtitlesByUrl(url, 'background-ai-error')) return;
            sttRenderContextStatus(`AI后台识别失败：${e.message}`);
            console.warn('[STT AutoScan] Failed for', url, e.message);
        } finally {
            sttSilentInFlight.delete(httpsUrl);
        }
    }

    // 主扫描入口：进入审单页面后自动找音频并后台识别
    let sttAutoScanDoneUrl = null;
    async function sttAutoScanPage() {
        if (!location.pathname.startsWith('/order/review')) return;
        if (!document.querySelector('.answer--review')) return;

        const currentUrl = location.href;
        if (sttAutoScanDoneUrl === currentUrl) return;

        const urls = sttCollectAudioUrls();
        if (urls.length === 0) {
            return; // 暂不标记已完成，让定时器下一次重新检测
        }

        sttAutoScanDoneUrl = currentUrl;
        console.log(`[STT AutoScan] Found ${urls.length} audio URL(s), ${sttIsAiEnabled() ? 'starting background recognition' : 'checking cached transcripts only'}...`, urls);

        for (const url of urls) {
            await sttSilentProcess(url);
        }

        console.log('[STT AutoScan] Background audio pass finished.');
    }


    let sttLastAudioSrc = null;
    function sttInit() {
        if (!location.pathname.startsWith('/order/review')) {
            const p = document.getElementById('sj-stt-status');
            if (p) p.remove();
            if (sttObserver) {
                sttObserver.disconnect();
                sttObserver = null;
            }
            sttLastAudioSrc = null;
            sttClearContextualTips();
            return;
        }

        const audio = document.querySelector('.el-dialog audio, .el-dialog__wrapper audio');
        if (!audio || !audio.src) {
            const p = document.getElementById('sj-stt-status');
            if (p) p.remove();
            if (sttObserver) {
                sttObserver.disconnect();
                sttObserver = null;
            }
            sttLastAudioSrc = null;
            return;
        }

        if (audio.src === sttLastAudioSrc) return;
        sttClearContextualTips();
        if (sttObserver) {
            sttObserver.disconnect();
            sttObserver = null;
        }
        const lyricUl = document.querySelector('.audio-player-lyric ul');
        if (lyricUl && lyricUl.dataset.sjSttSource && lyricUl.dataset.sjSttSource !== sttAudioKey(audio.src)) {
            delete lyricUl.dataset.sjSttSource;
            delete lyricUl.dataset.sjSttMode;
        }
        sttLastAudioSrc = audio.src;

        const dialogBody =
            audio.closest('.el-dialog__body') ||
            audio.closest('.el-dialog') ||
            audio.closest('.el-dialog__wrapper');
        if (!dialogBody) return;

        sttProcess(audio, dialogBody);
    }

    // 自动折叠不需要做（或由一键通过自动判定）的题目卡片
    function autoReviewCollapseUnneeded() {
        const reviews = document.querySelectorAll('.answer--review');
        if (reviews.length === 0) return;

        // 寻找包含该题目的整张卡片以及题号
        function findQuestionCard(review) {
            let temp = review.parentElement; // 从父级开始向上找，避免直接在 review 内部误判
            while (temp && temp !== document.body) {
                // 寻找标题元素
                const titleEl = temp.querySelector('.answer-title, h4, h3, .el-form-item__label, .answer-question-title, [class*="title"], [class*="header"]');
                if (titleEl) {
                    const txt = titleEl.textContent.trim();
                    const match = txt.match(/^[qQ](\d+)/);
                    if (match) {
                        return {
                            card: temp,
                            qNum: 'Q' + match[1],
                            titleEl: titleEl
                        };
                    }
                }
                temp = temp.parentElement;
            }
            return null;
        }

        reviews.forEach((review) => {
            const cardInfo = findQuestionCard(review);
            if (!cardInfo) return;

            const { card, qNum, titleEl } = cardInfo;
            let shouldCollapse = false;

            if (['Q1', 'Q2', 'Q6', 'Q14', 'Q17'].includes(qNum)) {
                // 这些题目默认折叠（除非用户手动展开了）
                shouldCollapse = !sttManuallyExpanded.has(qNum);
            } else if (qNum === 'Q13') {
                // Q13 根据自身的选项决定是否折叠：
                // 如果勾选了“无脉动冰柜”、“无”、“没有”等，并且未手动展开，则折叠
                let q13HasNoFreezer = false;
                const checkedOption = card.querySelector('.el-radio.is-checked, .el-checkbox.is-checked, input:checked');
                if (checkedOption) {
                    const txt = checkedOption.textContent.trim() || checkedOption.value || '';
                    if (txt.includes('无') || txt.includes('没有') || txt.includes('否')) {
                        q13HasNoFreezer = true;
                    }
                }
                shouldCollapse = q13HasNoFreezer && !sttManuallyExpanded.has(qNum);
            }

            // 绑定点击交互逻辑 (仅限一次，绑定在整张卡片上)
            if (!card.dataset.sjCollapseBound) {
                card.dataset.sjCollapseBound = 'true';
                card.addEventListener('click', (e) => {
                    // 折叠状态下，点击卡片任意区域都触发展开
                    if (card.classList.contains('sj-collapsed-card')) {
                        card.classList.remove('sj-collapsed-card');
                        sttManuallyExpanded.add(qNum);
                        const toggleBtn = card.querySelector('.sj-collapse-toggle-btn');
                        if (toggleBtn) toggleBtn.innerHTML = ` ↔️ 收起`;
                        e.stopPropagation();
                        e.preventDefault();
                    } else {
                        // 展开状态下，只有点击“收起”按钮才折叠回去
                        if (e.target.classList.contains('sj-collapse-toggle-btn')) {
                            card.classList.add('sj-collapsed-card');
                            sttManuallyExpanded.delete(qNum);
                            const toggleBtn = card.querySelector('.sj-collapse-toggle-btn');
                            if (toggleBtn) toggleBtn.innerHTML = ` ↔️ 展开`;
                            e.stopPropagation();
                            e.preventDefault();
                        }
                    }
                });
            }

            if (shouldCollapse) {
                if (!card.classList.contains('sj-collapsed-card')) {
                    card.classList.add('sj-collapsed-card');
                }
                let toggleBtn = card.querySelector('.sj-collapse-toggle-btn');
                if (!toggleBtn) {
                    toggleBtn = document.createElement('span');
                    toggleBtn.className = 'sj-collapse-toggle-btn';
                    toggleBtn.style.color = '#409EFF';
                    toggleBtn.style.cursor = 'pointer';
                    toggleBtn.style.marginLeft = '10px';
                    toggleBtn.style.fontWeight = 'bold';
                    toggleBtn.style.fontSize = '12px';
                    
                    titleEl.appendChild(toggleBtn);
                }
                toggleBtn.innerHTML = ` ↔️ 展开`;
            } else {
                if (card.classList.contains('sj-collapsed-card')) {
                    card.classList.remove('sj-collapsed-card');
                }
                let toggleBtn = card.querySelector('.sj-collapse-toggle-btn');
                if (toggleBtn) {
                    toggleBtn.innerHTML = ` ↔️ 收起`;
                }
            }
        });
    }

    // 初始化入口（每次由 init 定时检查，无额外并发定时器）
    function autoReviewInit() {
        if (!location.pathname.startsWith('/order/review')) {
            const btn = document.getElementById('sj-auto-review-btn');
            if (btn) btn.remove();
            const openBtn = document.getElementById('sj-open-recording-btn');
            if (openBtn) openBtn.remove();
            const controlPanel = document.getElementById('sj-control-panel');
            if (controlPanel) controlPanel.remove();
            sjRecordingAutoOpenOrderKey = '';
            sttCurrentOrderTranscripts = {};
            sttLastLocationHref = null;
            return;
        }

        const currentUrl = location.href;
        if (sttLastLocationHref !== currentUrl) {
            sttLastLocationHref = currentUrl;
            sttCurrentOrderTranscripts = {};
            sttAutoScanDoneUrl = null;
            sttManuallyExpanded.clear(); // 切换新工单时重置手动展开记录
        }

        // 直接同步检测题目面板是否存在且一键通过按钮尚未渲染，满足才创建
        if (document.querySelector('.answer--review')) {
            if (!document.getElementById('sj-auto-review-btn')) {
                autoReviewCreatePanel();
            }
            // 自动在后台异步扫描并识别所有音频
            sjRecordingCreateOpenButton();
            sjRecordingAutoOpenForOrder();
            sttAutoScanPage();

            // 持续恢复 AI 提示框渲染 (防 Vue 响应式重绘擦除)
            sttUpdateContextualTips();

            // 自动折叠非必须审核的题目卡片
            autoReviewCollapseUnneeded();

            // 单槽预取：进入新订单后清空已消费槽，再补充且只补充一单。
            const match = location.pathname.match(/\/order\/review\/(\d+)/);
            if (match) {
                const currentOrderId = match[1];
                sjFinalizePrefetchSlotForCurrentOrder(currentOrderId);
                const projectId = sjGetActiveProjectId();
                if (projectId) {
                    sjPrefetchNextOrder(currentOrderId, projectId);
                }
            }

            // 网络拦截未命中时，以网站成功弹窗兜底。
            if (typeof autoReviewGetVisibleSuccessDialog === 'function' && autoReviewGetVisibleSuccessDialog()) {
                sjTriggerPrefetchJump('success-dialog-fallback');
            }
        }

        // AI 字幕识别
        sttInit();
    }

    // 初始化按钮与面板
    const init = () => {
