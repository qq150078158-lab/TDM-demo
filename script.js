document.addEventListener('DOMContentLoaded', () => {
    const API_URL = "/api/proxy";

    // 声明一个全局变量来存储后端返回的完整数据
    let chartDataStore = null;
    let cryptoSymbols = []; // 存储所有加密货币代码

    const modelChart = echarts.init(document.getElementById('model-chart'), 'dark');

    const runButton = document.getElementById('run-inference');
    const loader = document.getElementById('loader');

    // --- 获取股票代码输入框 ---
    const stockCodeInput = document.getElementById('stock-code-input');

    // 获取自动补全列表的 DOM 元素
    const autocompleteList = document.getElementById('autocomplete-list');

    // --- 获取下拉框元素 ---
    const versionSelect = document.getElementById('version-select');
    const marketSelect = document.getElementById('market-select');
    const frequencySelect = document.getElementById('frequency-select');

    // --- 期货模拟相关 ---
    const useLeverageCheckbox = document.getElementById('use-leverage');
    const minLeverageInput = document.getElementById('min-leverage');
    const maxLeverageInput = document.getElementById('max-leverage');
    const maintenanceMarginRateInput = document.getElementById('maintenance-margin-rate');
    const allowFloatingProfitToOpenCheckbox = document.getElementById('allow-floating-profit-to-open');
    let savedLeverageConfig = null;

    // --- 手续费与最大回撤 ---
    const openFeeRateInput = document.getElementById('open-fee-rate');
    const closeFeeRateInput = document.getElementById('close-fee-rate');
    const useMaxDrawdownCheckbox = document.getElementById('use-max-drawdown');
    const maxDrawdownLimitInput = document.getElementById('max-drawdown-limit');

    // --- 版本与选项的配置映射 ---
    const VERSION_CONFIG = {
        'v0305_small': {
            markets: ['A Stocks', 'US Stocks', 'HongKong Stocks'],
            getFrequencies: (market) => ['1week', '1day', '1hour']
        },

    };

    // 由 renderTradeLog / renderAccountHistory 共用
    // 格式化已实现/未实现盈亏：带符号 + 两位小数
    function formatPnl(v) {
        const n = Number(v) || 0;
        const sign = n >= 0 ? '+' : '';
        return `${sign}${n.toFixed(2)}`;
    }

    // 数值裁剪
    function clampNumber(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    // 按最大杠杆计算默认维持保证金率
    function calcDefaultMaintenanceMarginRate(maxLeverage) {
        const maxLev = clampNumber(parseFloat(maxLeverage) || 1, 1, 20);
        return clampNumber(1 / maxLev / 2, 0.01, 1.0);
    }

    // 同步杠杆相关控件的启用状态
    function syncLeverageControls({ preserveValues = false } = {}) {
        const enabled = useLeverageCheckbox.checked;

        minLeverageInput.disabled = !enabled;
        maxLeverageInput.disabled = !enabled;
        maintenanceMarginRateInput.disabled = !enabled;
        allowFloatingProfitToOpenCheckbox.disabled = !enabled;

        if (!enabled) {
            // ---------- 未启用杠杆 ----------
            if (!preserveValues) {
                // 用户主动取消勾选：先快照当前配置，再视觉上重置为"无杠杆"状态
                if (savedLeverageConfig === null) {
                    savedLeverageConfig = {
                        minLeverage: minLeverageInput.value,
                        maxLeverage: maxLeverageInput.value,
                        maintenanceMarginRate: maintenanceMarginRateInput.value,
                        maintenanceMarginRateAuto:
                            maintenanceMarginRateInput.dataset.auto || 'true',
                        allowFloatingProfitToOpen: allowFloatingProfitToOpenCheckbox.checked,
                    };
                }
                // 视觉重置（仅 UI 层，不影响已保存的快照）
                minLeverageInput.value = 1;
                maxLeverageInput.value = 1;
                maintenanceMarginRateInput.value = '0.1';
                allowFloatingProfitToOpenCheckbox.checked = false;
            }
            // preserveValues=true（初始化）时：保留 HTML 默认值不动
        } else {
            // ---------- 启用杠杆 ----------
            if (savedLeverageConfig !== null) {
                // 存在快照：完整恢复用户上次的配置
                let minLev = clampNumber(parseFloat(savedLeverageConfig.minLeverage) || 1, 1, 20);
                let maxLev = clampNumber(parseFloat(savedLeverageConfig.maxLeverage) || 5, 1, 20);
                if (minLev > maxLev) minLev = maxLev;

                minLeverageInput.value = minLev;
                maxLeverageInput.value = maxLev;
                maintenanceMarginRateInput.value = savedLeverageConfig.maintenanceMarginRate;
                maintenanceMarginRateInput.dataset.auto =
                    savedLeverageConfig.maintenanceMarginRateAuto;
                allowFloatingProfitToOpenCheckbox.checked =
                    savedLeverageConfig.allowFloatingProfitToOpen;

                // 快照用后即弃，避免污染
                savedLeverageConfig = null;
            } else {
                // 首次勾选（或初始化后第一次勾选）
                // 读取当前 UI 值
                let minLev = clampNumber(parseFloat(minLeverageInput.value) || 1, 1, 20);
                let maxLev = clampNumber(parseFloat(maxLeverageInput.value) || 5, 1, 20);
                if (minLev > maxLev) minLev = maxLev;

                minLeverageInput.value = minLev;
                maxLeverageInput.value = maxLev;

                // 首次进入启用状态
                maintenanceMarginRateInput.dataset.auto = 'true';
                maintenanceMarginRateInput.value =
                    calcDefaultMaintenanceMarginRate(maxLev).toFixed(4);
            }
        }
    }

    // --- 动态更新下拉框选项的逻辑 ---
    function updateDropdownOptions() {
        const currentVersion = versionSelect.value;
        const config = VERSION_CONFIG[currentVersion];

        // 1. 更新 Market 选项
        const validMarkets = config.markets;
        const currentMarketSelection = marketSelect.value;

        marketSelect.innerHTML = ''; // 清空现有选项
        validMarkets.forEach(market => {
            const option = document.createElement('option');
            option.value = market;
            option.textContent = market;
            marketSelect.appendChild(option);
        });

        // 尝试保持之前的选择，如果不再有效则选择第一个默认值
        if (validMarkets.includes(currentMarketSelection)) {
            marketSelect.value = currentMarketSelection;
        } else {
            marketSelect.value = validMarkets[0];
        }

        // 2. 更新 Frequency 选项 (基于当前选中的 Market)
        const currentMarket = marketSelect.value;
        const validFrequencies = config.getFrequencies(currentMarket);
        const currentFreqSelection = frequencySelect.value;

        frequencySelect.innerHTML = ''; // 清空现有选项
        validFrequencies.forEach(freq => {
            const option = document.createElement('option');
            option.value = freq;
            option.textContent = freq;
            frequencySelect.appendChild(option);
        });

        // 尝试保持之前的选择，如果不再有效则选择第一个默认值
        if (validFrequencies.includes(currentFreqSelection)) {
            frequencySelect.value = currentFreqSelection;
        } else {
            frequencySelect.value = validFrequencies[0];
        }

        // 触发一次 Market Change 以加载 Symbols
        handleMarketChange();
    }

    // --- 异步获取加密货币代码 ---
    async function fetchCryptoSymbols() {
        if (cryptoSymbols.length > 0) return; // 已加载则不再加载

        try {
            console.log("Fetching crypto symbols...");
            // 使用 POST 请求发送
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // 添加 action 字段
                body: JSON.stringify({ action: 'get_symbols' })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.symbols) {
                    cryptoSymbols = data.symbols;
                    console.log(`Loaded ${cryptoSymbols.length} crypto symbols.`);
                } else {
                    console.warn("Response format error: 'symbols' field missing");
                }
            } else {
                console.error("Failed to fetch symbols:", response.statusText);
            }
        } catch (error) {
            console.error("Error fetching symbols:", error);
        }
    }

    function handleMarketChange() {
        const market = marketSelect.value;
        const version = versionSelect.value;

        // 按市场判断
        if (market === 'Crypto') {
            // 已禁用 fetchCryptoSymbols();
            stockCodeInput.placeholder = "e.g. BTCUSDT";
        } else if (market === 'US Stocks') {
            // 美股市场
            stockCodeInput.placeholder = "e.g. AAPL";
            // 已禁用 closeAllLists();
        } else if (market === 'HongKong Stocks') {
            // 港股市场
            stockCodeInput.placeholder = "e.g. 0836.HK";
            // 如需禁用其他操作可在此添加，当前仅设置 placeholder
        } else {
            // 默认A股
            stockCodeInput.placeholder = "e.g. 600000";
            // 隐藏并清空自动补全
            // 已禁用 closeAllLists();
        }
    }

    // --- 自动补全逻辑 ---
    function closeAllLists(elmnt) {
        if (!autocompleteList) return;

        if (elmnt !== stockCodeInput) {
            autocompleteList.innerHTML = '';
            autocompleteList.style.display = 'none';
        }
    }

    stockCodeInput.addEventListener('input', function(e) {
        const val = this.value;

        // 仅保留非空校验逻辑，摘掉根据代码实时筛选的逻辑
        runButton.disabled = val.trim() === "";

    });


    // --- 绑定事件监听器 ---
    versionSelect.addEventListener('change', updateDropdownOptions);
    marketSelect.addEventListener('change', updateDropdownOptions);

    // --- 初始化页面时运行一次以设置正确状态 ---
    updateDropdownOptions();


    // --- 初始化最大回撤控件状态 ---
    function syncMaxDrawdownControls() {
        const enabled = useMaxDrawdownCheckbox.checked;
        maxDrawdownLimitInput.disabled = !enabled;
        if (!enabled) {
            // 保留原值
        }
    }

    syncMaxDrawdownControls();

    useMaxDrawdownCheckbox.addEventListener('change', syncMaxDrawdownControls);

    // 初始化杠杆控件状态
    syncLeverageControls({ preserveValues: true });

    // 启用杠杆开关
    useLeverageCheckbox.addEventListener('change', () => {
        syncLeverageControls();
    });

    // 最大杠杆变化
    maxLeverageInput.addEventListener('input', () => {
        let maxLev = clampNumber(parseFloat(maxLeverageInput.value) || 5, 1, 20);
        let minLev = clampNumber(parseFloat(minLeverageInput.value) || 1, 1, 20);
        if (minLev > maxLev) minLev = maxLev;

        minLeverageInput.value = minLev;
        maxLeverageInput.value = maxLev;

        if (maintenanceMarginRateInput.dataset.auto !== 'false') {
            maintenanceMarginRateInput.value = calcDefaultMaintenanceMarginRate(maxLev).toFixed(4);
        }
    });

    // 最小杠杆变化
    minLeverageInput.addEventListener('input', () => {
        let minLev = clampNumber(parseFloat(minLeverageInput.value) || 1, 1, 20);
        let maxLev = clampNumber(parseFloat(maxLeverageInput.value) || 5, 1, 20);
        if (minLev > maxLev) maxLev = minLev;

        minLeverageInput.value = minLev;
        maxLeverageInput.value = maxLev;
    });

    // 用户手动修改维持保证金率
    maintenanceMarginRateInput.addEventListener('input', () => {
        maintenanceMarginRateInput.dataset.auto = 'false';
        const mmr = clampNumber(parseFloat(maintenanceMarginRateInput.value) || 0.1, 0.01, 1.0);
        maintenanceMarginRateInput.value = mmr;
    });


    // --- 页面加载时，按钮默认为不可用 ---
    runButton.disabled = true;


    // 确保 "Model Inference" 区域始终显示标签，以保持顶部控制栏高度
    function setEmptyModelResults() {
        const modelResultsContent = document.getElementById('model-results-content');
        if (modelResultsContent) {
            modelResultsContent.innerHTML = `
                <div class="result-item">
                    <span class="result-item-label">End-point Returns:</span>
                    <span class="result-item-value"></span>
                </div>
                <div class="result-item">
                    <span class="result-item-label">Sharp Ratio:</span>
                    <span class="result-item-value"></span>
                </div>
                <div class="result-item">
                    <span class="result-item-label">Max Drawdown:</span>
                    <span class="result-item-value"></span>
                </div>
            `;
        }
    }

    // 定义一个函数，用于在不重新请求后端数据的情况下重绘图表
    function rerenderCharts() {
        if (!chartDataStore) return; // 如果没有数据，则不执行任何操作

        const { modelMarkPoints, categories, klineValues, volumeValues, modelAssetCurve } = prepareChartData(chartDataStore);

        renderChart(modelChart, 'Model Inference', categories, klineValues, modelMarkPoints, volumeValues, modelAssetCurve);

        // 同步刷新 MODEL RAW OUTPUT：
        // confidence-threshold 变化会改变“是否会被降级为 hold”的判定，因此需要按新阈值重新渲染弱化样式与警示文本
        renderModelRawOutput('model-raw-output-content', chartDataStore.model_actions);
    }


    async function fetchAndRender() {
        loader.style.display = 'block';
        runButton.disabled = true;

        // 在请求新数据前，先清空图表和数据存储
        initializeEmptyCharts();
        chartDataStore = null;

        // --- 清空日志区域 ---
        document.getElementById('model-raw-output-content').innerHTML = '';
        document.getElementById('model-trade-log-content').innerHTML = '';
        document.getElementById('model-account-history-content').innerHTML = '';

        // --- 清空结果区域 ---
        setEmptyModelResults();

        // --- 获取所有输入控件的值 ---
        const version = document.getElementById('version-select').value;
        const market = document.getElementById('market-select').value;
        const frequency = document.getElementById('frequency-select').value;
        let stockCode = document.getElementById('stock-code-input').value;
        const klineWindowSize = document.getElementById('kline-window-size').value;
        const confidenceThreshold = parseFloat(document.getElementById('confidence-threshold').value);
        const allowShort = document.getElementById('allow-short').checked;

        const useLeverage = useLeverageCheckbox.checked;
        let minLeverage = parseFloat(minLeverageInput.value) || 1;
        let maxLeverage = parseFloat(maxLeverageInput.value) || 1;
        let maintenanceMarginRate = parseFloat(maintenanceMarginRateInput.value) || 0.1;
        const allowFloatingProfitToOpen = allowFloatingProfitToOpenCheckbox.checked;

        // --- 手续费与最大回撤 ---
        const openFeeRate = parseFloat(openFeeRateInput.value) / 100;   // 百分比转小数
        const closeFeeRate = parseFloat(closeFeeRateInput.value) / 100; // 百分比转小数
        const useMaxDrawdown = useMaxDrawdownCheckbox.checked;
        let maxDrawdownLimit = null;
        if (useMaxDrawdown) {
            maxDrawdownLimit = parseFloat(maxDrawdownLimitInput.value) / 100; // 百分比转小数
        }

        // 未启用杠杆时，强制 1 倍
        if (!useLeverage) {
            minLeverage = 1;
            maxLeverage = 1;
        }

        // --- 校验代码 ---
        if (!stockCode || stockCode.trim() === "") {
            alert("请输入代码 (Code)");
            loader.style.display = 'none';
            runButton.disabled = true;
            return;
        }

        // 用户只需输入准确代码 (e.g., "BTCUSDT")，后端返回时强制增加 "spot_" 标志
        if (market === 'Crypto') {
            // 如果用户没有输入 spot_ 前缀，强制加上
            if (stockCode && !stockCode.startsWith('spot_')) {
                stockCode = 'spot_' + stockCode;
            }
        }

        try {
            // --- fetch 请求 ---
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                // --- 发送所有输入数据 ---
                body: JSON.stringify({
                    version: version,
                    market: market,
                    frequency: frequency,
                    stock_code: stockCode,
                    kline_window_size: parseInt(klineWindowSize, 10),
                    confidence_threshold: confidenceThreshold,
                    allow_short: allowShort,
                    use_leverage: useLeverage,
                    min_leverage: minLeverage,
                    max_leverage: maxLeverage,
                    maintenance_margin_rate: maintenanceMarginRate,
                    allow_floating_profit_to_open: allowFloatingProfitToOpen,
                    open_fee_rate: openFeeRate,
                    close_fee_rate: closeFeeRate,
                    use_max_drawdown: useMaxDrawdown,
                    max_drawdown_limit: maxDrawdownLimit,
                })
            });

            // 先读 Content-Type，再决定解析方式
            const contentType = response.headers.get('content-type') || '';
            const isJson = contentType.includes('application/json');

            // --- 非 2xx ---
            if (!response.ok) {
                let detail;
                if (isJson) {
                    const errorData = await response.json().catch(() => ({}));
                    detail = errorData.detail
                        || errorData.hf_response_body
                        || JSON.stringify(errorData).slice(0, 300);
                } else {
                    // 纯文本（例如 Vercel "An error occurred..."、502/504 网关页）
                    const text = await response.text();
                    detail = '网关/平台错误: ${text.slice(0, 300)}';
                }
                throw new Error('HTTP ${response.status}: ${detail}');
            }

            // --- 2xx 但 body 不是 JSON ---
            if (!isJson) {
                const text = await response.text();
                throw new Error('服务器返回了非 JSON 内容: ${text.slice(0, 300)}');
            }

            // 将获取到的数据存入全局变量
            chartDataStore = await response.json();

            console.log("成功接收并存储后端数据:", chartDataStore);

            if (!chartDataStore || !chartDataStore.kline_data || chartDataStore.kline_data.length === 0) {
                alert("未能加载有效的K线数据，请检查代码或频率");
                loader.style.display = 'none';
                runButton.disabled = false;
                return;
            }

            // --- 显示模型策略的模拟交易结果 ---
            const modelResultsContent = document.getElementById('model-results-content');

            const modelSimResults = chartDataStore.model_simulation_results;

            // 辅助函数，用于填充结果区域
            function populateResults(element, results, config, stats) {
                if (!results) {
                    if (element.id === 'model-results-content') {
                        setEmptyModelResults();
                    } else {
                        element.innerHTML = '<div class="result-item"><span class="result-item-label">No data</span></div>';
                    }
                    return;
                }

                let html = `
                    <div class="result-item">
                        <span class="result-item-label">End-point Returns:</span>
                        <span class="result-item-value">${(results.final_return_rate * 100).toFixed(2)}%</span>
                    </div>
                    <div class="result-item">
                        <span class="result-item-label">Sharp Ratio:</span>
                        <span class="result-item-value">${results.sharpe_ratio.toFixed(3)}</span>
                    </div>
                    <div class="result-item">
                        <span class="result-item-label">Max Drawdown:</span>
                        <span class="result-item-value">${(results.max_drawdown * 100).toFixed(2)}%</span>
                    </div>
                `;

                if (config) {
                    const leverageText = config.use_leverage
                        ? `${config.min_leverage.toFixed(1)}x - ${config.max_leverage.toFixed(1)}x`
                        : 'Disabled';

                    html += `
                        <div class="result-item">
                            <span class="result-item-label">Leverage:</span>
                            <span class="result-item-value">${leverageText}</span>
                        </div>
                        <div class="result-item">
                            <span class="result-item-label">Maintenance Margin:</span>
                            <span class="result-item-value">${(config.maintenance_margin_rate * 100).toFixed(2)}%</span>
                        </div>
                        <div class="result-item">
                            <span class="result-item-label">Floating Profit Open:</span>
                            <span class="result-item-value">${config.allow_floating_profit_to_open ? 'Yes' : 'No'}</span>
                        </div>
                    `;
                }

                if (stats) {
                    html += `
                        <div class="result-item">
                            <span class="result-item-label">Forced Close:</span>
                            <span class="result-item-value">${stats.forced_close_count}</span>
                        </div>
                        <div class="result-item">
                            <span class="result-item-label">Force Reduce:</span>
                            <span class="result-item-value">${stats.force_reduce_count}</span>
                        </div>
                        <div class="result-item">
                            <span class="result-item-label">Max Leverage Used:</span>
                            <span class="result-item-value">${stats.max_leverage_used.toFixed(2)}x</span>
                        </div>
                    `;
                }

                element.innerHTML = html;
            }

            // 分别填充最优策略和模型策略的结果
            populateResults(
                modelResultsContent,
                modelSimResults,
                chartDataStore.simulation_config,
                chartDataStore.simulation_stats
            );

            const { modelMarkPoints, categories, klineValues, volumeValues, modelAssetCurve } = prepareChartData(chartDataStore);

            // 渲染图表
            renderChart(modelChart, 'Model Inference', categories, klineValues, modelMarkPoints, volumeValues, modelAssetCurve);

            // --- 渲染详细日志 ---
            renderModelRawOutput('model-raw-output-content', chartDataStore.model_actions);
            renderTradeLog('model-trade-log-content', chartDataStore.model_trade_log);
            renderAccountHistory('model-account-history-content', chartDataStore.model_account_history);

        } catch (error) {
            console.error("获取或渲染数据时出错:", error);
            alert(`加载数据失败: ${error.message}`);
        } finally {
            loader.style.display = 'none';
            // 请求结束后，按钮的可用状态应重新根据输入框内容判断
            if (stockCodeInput) {
                runButton.disabled = stockCodeInput.value.trim() === "";
            } else {
                runButton.disabled = false; // 备用方案
            }
        }
    }

    // --- 标记点生成逻辑 ---
    function prepareChartData(data) {
        const categories = data.kline_data.map(item => new Date(item.timestamp * 1000).toLocaleString());
        const klineValues = data.kline_data.map(item => [item.open, item.close, item.low, item.high]);

        // 提取成交量数据
        const volumeValues = data.kline_data.map(item => item.volume);
        // 提取资产曲线数据
        const modelAssetCurve = data.model_asset_curve;

        const longSymbol = 'path://M0,10 L5,0 L10,10 Z'; // 向上箭头
        const shortSymbol = 'path://M0,0 L5,10 L10,0 Z'; // 向下箭头

        const showHold = document.getElementById('show-hold').checked;

        // 从输入框获取置信度阈值
        const confidenceThreshold = parseFloat(document.getElementById('confidence-threshold').value) || 0.0;

        // --- hold 标记的自定义 ---
        const holdSymbol = 'path://M0,0 L8,5 L0,10 Z'; // 1. 自定义右箭头图标
        let lastPosition = 'below'; // 2. 用于追踪前一个非hold动作标记位置的变量，默认为下方

        const modelMarkPoints = data.model_actions.map((action, i) => {
            if (i >= data.kline_data.length) return null;
            const confidence = action.confidence || 0;

            // 根据置信度阈值过滤标记点
            if ((action.action_type === 'long' || action.action_type === 'short') && confidence < confidenceThreshold) {
                return null; // 如果置信度低于阈值，则不显示该标记
            }

            const alpha = 0.3 + 0.7 * confidence;

            if (action.action_type === 'long') {
                lastPosition = 'below'; // 更新位置状态
                return { name: 'Long', coord: [i, data.kline_data[i].low], symbol: longSymbol, symbolSize: 8, symbolOffset: [0, 8], itemStyle: { color: `rgba(73, 170, 25, ${alpha})` } };
            } else if (action.action_type === 'short') {
                lastPosition = 'above'; // 更新位置状态
                return { name: 'Short', coord: [i, data.kline_data[i].high], symbol: shortSymbol, symbolSize: 8, symbolOffset: [0, -8], itemStyle: { color: `rgba(255, 77, 79, ${alpha})` } };
            } else if (action.action_type === 'hold' && showHold) {
                // 3. 根据 lastPosition 决定 hold 标记的位置
                const yCoord = lastPosition === 'below' ? data.kline_data[i].low : data.kline_data[i].high;
                const yOffset = lastPosition === 'below' ? 12 : -12;

                return {
                    name: 'Hold',
                    coord: [i, yCoord],
                    symbol: holdSymbol, // 使用自定义右箭头
                    symbolSize: 8,
                    symbolOffset: [0, yOffset],
                    itemStyle: { color: `rgba(80, 140, 255, ${alpha})` }
                };
            }
            return null;
        }).filter(Boolean);

        // --- 返回数据 ---
        return { modelMarkPoints, categories, klineValues, volumeValues, modelAssetCurve };
    }

    // --- Tooltip 内容 ---
    function renderChart(chartInstance, title, categories, klineValues, markPointData, volumeValues, assetCurveData) {
        const option = {
            title: {
                text: title,
                // --- 添加副标题 ---
                subtext: 'forward-adjusted & T+1 delayed',
                left: 'center',
                top: 10, // 为标题增加上边距
                textStyle: { color: '#e0e0e0', fontWeight: 'normal' },
                // --- 设置副标题样式 ---
                subtextStyle: {
                    color: '#b0b0b0', // 使用稍暗的颜色
                    fontSize: 12      // 使用较小的字号
                }
            },
            backgroundColor: 'transparent',
            // 联动 tooltip 和 crosshair
            axisPointer: {
                link: [{ xAxisIndex: 'all' }]
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                // 自定义 tooltip 内容
                formatter: function (params) {
                     if (!chartDataStore || !chartDataStore.kline_data.length || !params || params.length === 0) {
                        return '暂无数据';
                    }

                    const dataIndex = params[0].dataIndex;
                    const klineInfo = chartDataStore.kline_data[dataIndex];
                    // const optimalAction = chartDataStore.optimal_actions[dataIndex];
                    const modelAction = chartDataStore.model_actions[dataIndex];

                    // 我们需要从图表系列中获取资产数据，以确保即使数据点在视图之外也能正确显示
                    let assetValue = null;
                    // 查找名为 'Assets' 的系列的数据
                    const assetSeries = params.find(p => p.seriesName === 'Assets');
                    if (assetSeries && assetSeries.value !== undefined) {
                        assetValue = assetSeries.value;
                    } else if (assetCurveData && assetCurveData[dataIndex] !== undefined) {
                        // 备用方案：直接从传入的数组中获取（如果系列不可见或未在params中）
                        assetValue = assetCurveData[dataIndex];
                    }

                    const formatVolume = (volume) => {
                        if (volume >= 1000000) return (volume / 1000000).toFixed(2) + 'M';
                        if (volume >= 1000) return (volume / 1000).toFixed(2) + 'K';
                        return volume;
                    };

                    // 格式化函数
                    const formatAction = (action) => {
                        if (!action) return 'N/A';
                        let type = action.action_type;
                        if (type === 'long') type = 'Long';
                        if (type === 'short') type = 'Short';
                        if (type === 'hold') type = 'Hold';
                        let details = `${type}`;
                        if (action.action_type !== 'hold') {
                            details += `, Q: ${(action.quantity_ratio).toFixed(4)}, L: ${action.leverage_ratio.toFixed(4)}`;
                        }
                        if (action.confidence !== undefined) {
                            details += `, Conf.: ${action.confidence.toFixed(4)}`;
                        }
                        return details;
                    };

                    let tooltipHtml = `<b>${new Date(klineInfo.timestamp * 1000).toLocaleString()}</b><br/>`;
                    tooltipHtml += `Open: ${klineInfo.open.toFixed(2)} | High: ${klineInfo.high.toFixed(2)} | Low: ${klineInfo.low.toFixed(2)} | Close: ${klineInfo.close.toFixed(2)}<hr style="margin: 5px 0; border-color: #555;">`;
                    tooltipHtml += `<b>Model  Inference:</b> ${formatAction(modelAction)}`;

                    // 检查 assetValue 是否有效
                    if (assetValue !== null && assetValue !== undefined) {
                        // 确保 assetValue 是一个数字，如果它是从 series.value 获取的
                        const numericAssetValue = typeof assetValue === 'number' ? assetValue : parseFloat(assetValue);
                        if (!isNaN(numericAssetValue)) {
                            tooltipHtml += `<br/><b>Simulate Asset:</b> ${numericAssetValue.toFixed(2)}`;
                        }
                    }

                    return tooltipHtml;
                }
            },
            // 使用两个 grid 上下布局 K线图和成交量图
            grid: [
                { // K线图 grid
                    left: '60px',
                    right: '60px',
                    top: '60px',
                    height: '65%'
                },
                { // 成交量图 grid
                    left: '60px',
                    right: '60px',
                    bottom: '80px',
                    height: '12%'
                }
            ],
            xAxis: [
                { // K线图 x轴
                    type: 'category',
                    data: categories,
                    scale: true,
                    axisLine: { onZero: false, show: false },
                    splitLine: { show: false },
                    axisLabel: { show: false }, // 隐藏此处的标签，避免与下方重叠
                    gridIndex: 0
                },
                { // 成交量图 x轴
                    type: 'category',
                    data: categories,
                    scale: true,
                    gridIndex: 1,
                    axisLine: { onZero: false, show: false },
                    axisTick: { show: false },
                    splitLine: { show: false },
                    axisLabel: { show: true }, // 在此显示时间标签
                }
            ],
            yAxis: [
                { // K线图 y轴 (价格)
                    scale: true,
                    splitArea: { show: false },
                    gridIndex: 0
                },
                { // 成交量图 y轴
                    scale: true,
                    gridIndex: 1,
                    axisLabel: {
                        formatter: function (value) {
                            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
                            if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
                            return value;
                        }
                     },
                    splitNumber: 2, // 减少刻度线数量
                    axisLine: { show: false },
                    axisTick: { show: false },
                    splitLine: { show: false }
                },
                // 为资产曲线添加右侧Y轴
                {
                    type: 'value',
                    // name: 'Assets',
                    position: 'right',
                    scale: true,
                    gridIndex: 0, // 关键：将此Y轴与K线图的grid关联
                    axisLabel: {
                        formatter: function (value) {
                            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
                            if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
                            return value.toFixed(0);
                        }
                    },
                    splitLine: { show: false } // 不显示此Y轴的分割线，保持图表简洁
                }
            ],
            dataZoom: [
                {
                    type: 'inside',
                    xAxisIndex: [0, 1], // 联动两个 x轴
                    start: 0,
                    end: 100
                },
                {
                    show: true,
                    type: 'slider',
                    xAxisIndex: [0, 1], // 联动两个 x轴
                    bottom: '30px',
                    start: 0,
                    end: 100,
                    height: 25
                }
            ],
            series: [{
                name: 'K线',
                type: 'candlestick',
                data: klineValues,
                xAxisIndex: 0,
                yAxisIndex: 0,
                itemStyle: {
                    color: '#49aa19',
                    color0: '#ff4d4f',
                    borderColor: '#49aa19',
                    borderColor0: '#ff4d4f'
                },
                markPoint: {
                    data: markPointData,
                    label: { show: false }
                }
            },
            // 成交量柱状图系列
            {
                name: '成交量',
                type: 'bar',
                data: volumeValues,
                xAxisIndex: 1,
                yAxisIndex: 1,
                itemStyle: {
                    // 根据K线涨跌决定成交量柱的颜色
                    color: function(params) {
                        const klineItem = klineValues[params.dataIndex];
                        // klineItem: [open, close, low, high]
                        return klineItem[1] >= klineItem[0] ? '#49aa19' : '#ff4d4f';
                    }
                }
            },
            // 资产曲线的 series 配置
            {
                name: 'Assets',
                type: 'line',
                data: assetCurveData,
                smooth: true,
                showSymbol: false,
                lineStyle: {
                    width: 0.3,
                    color: '#FFFF00',
                    // type: 'dashed'
                },
                xAxisIndex: 0, // 关键：与K线图共享X轴
                yAxisIndex: 2  // 关键：关联到新增的右侧Y轴 (索引2)
            }]
        };
        chartInstance.setOption(option, true);
    }

    // --- 渲染 模型原始输出 ---
    function renderModelRawOutput(elementId, actionsData) {
        const container = document.getElementById(elementId);
        if (!container) return;

        container.innerHTML = '';

        // 空数据保护
        if (!actionsData || actionsData.length === 0) {
            container.innerHTML = '<div>No model output available.</div>';
            return;
        }

        // padding 长度
        let contextLen = 128;
        if (chartDataStore
            && Array.isArray(chartDataStore.model_account_history)
            && chartDataStore.model_account_history.length > 0) {
            const firstStep = Number(chartDataStore.model_account_history[0].step);
            if (Number.isFinite(firstStep) && firstStep >= 0) {
                contextLen = firstStep;
            }
        }
        const startIndex = Math.min(contextLen, actionsData.length);

        // 读取当前置信度阈值，与图表标记过滤逻辑保持一致
        const confidenceThreshold =
            parseFloat(document.getElementById('confidence-threshold').value) || 0.0;

        actionsData.slice(startIndex).forEach((action, i) => {
            // 使用切片后的局部索引 i 重建全局 step
            const globalIndex = startIndex + i;

            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry';

            // ---- 1. 字段解析与安全取值 ----
            const actionType = (action.action_type || 'hold').toLowerCase();
            const confidence = Number(action.confidence) || 0;
            const qty = Number(action.quantity_ratio) || 0;
            const lev = Number(action.leverage_ratio) || 0;

            // ---- 2. 判断是否会被模拟器“降级为 hold” ----
            const willBeForcedHold =
                (actionType === 'long' || actionType === 'short') &&
                confidence <= confidenceThreshold;

            if (willBeForcedHold) {
                logEntry.classList.add('log-entry-muted');
            }

            // ---- 3. 复用已有的方向着色类 ----
            const dirCls = `log-pos-${actionType}`;

            // ---- 4. 数值格式化：统一 4 位小数 ----
            // 数量带符号显示，便于直观区分加仓 (+) 与减仓 (-)
            const qtySign = qty >= 0 ? '+' : '';
            const qtyStr = `${qtySign}${qty.toFixed(4)}`;
            const levStr = lev.toFixed(4);
            const confStr = confidence.toFixed(4);

            // ---- 5. 组装行 HTML ----
            // Step N:  <TAG>  | Qty: ... | Lev: ... | Conf: ... <警示>
            let html =
                `<span class="log-step">Step ${globalIndex}:</span>` +
                `<span class="${dirCls}">${actionType.toUpperCase()}</span>` +
                ` | Qty: ${qtyStr}` +
                ` | Lev: ${levStr}` +
                ` | Conf: ${confStr}`;

            // 若会被模拟器降级为 hold，追加警示
            if (willBeForcedHold) {
                html += ` <span class="log-warn">` +
                        `[Conf ${confStr} ≤ ${confidenceThreshold.toFixed(4)} → forced HOLD]` +
                        `</span>`;
            }

            logEntry.innerHTML = html;
            container.appendChild(logEntry);
        });
    }

    // --- 渲染日志的辅助函数 ---
    function renderTradeLog(elementId, logData) {
        const container = document.getElementById(elementId);
        if (!container) return;

        container.innerHTML = '';
        if (!logData || logData.length === 0) {
            container.innerHTML = '<div>No trades executed.</div>';
            return;
        }

        // 从全局数据存储中读取模拟配置，用于场景自适应
        const simCfg = (chartDataStore && chartDataStore.simulation_config) || {};
        const useLeverage = !!simCfg.use_leverage;

        // 交易类型映射表：type → { CSS 类, 展示标签 }
        // 后端 type 枚举：
        //   'open' | 'add' | 'reduce' | 'close' | 'force_reduce' | 'force_close'
        const TYPE_META = {
            open:         { cls: 'log-action-open',         label: 'OPEN' },
            add:          { cls: 'log-action-add',          label: 'ADD' },
            reduce:       { cls: 'log-action-reduce',       label: 'REDUCE' },
            close:        { cls: 'log-action-close',        label: 'CLOSE' },
            force_reduce: { cls: 'log-action-force-reduce', label: 'FORCE REDUCE' },
            force_close:  { cls: 'log-action-force-close',  label: 'FORCE CLOSE' },
        };

        logData.forEach(entry => {
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry';
            // 强平类事件整行加浅红底色
            if (entry.type === 'force_reduce' || entry.type === 'force_close') {
                logEntry.classList.add('log-entry-danger');
            }

            const meta = TYPE_META[entry.type] || { cls: '', label: (entry.type || '').toUpperCase() };
            const dirCls = entry.direction === 'long' ? 'log-pos-long'
                         : entry.direction === 'short' ? 'log-pos-short'
                         : 'log-pos-hold';
            const dirLabel = (entry.direction || '').toUpperCase();

            const qty = Number(entry.quantity) || 0;
            const price = Number(entry.price) || 0;
            const tradeValue = qty * price;

            // 已实现盈亏：仅减/平仓类交易语义有效
            const pnlVal = Number(entry.pnl);
            const pnlRelevant = entry.type !== 'open' && entry.type !== 'add'
                                && entry.pnl !== undefined && entry.pnl !== null;
            const shouldShowPnl = pnlRelevant && Math.abs(pnlVal) > 1e-9;

            // --- 本步盯市结算盈亏（每日无负债结算） ---
            // 反映本时间步内持仓按收盘价结算产生的浮动盈亏
            // 由于结算已并入 available_funds，故平仓时 pnl 常为 0，但 settled_pnl 可正可负
            const settledVal = Number(entry.settled_pnl);
            const shouldShowSettled = entry.settled_pnl !== undefined
                                      && entry.settled_pnl !== null
                                      && Math.abs(settledVal) > 1e-9;

            // --- 组装基础行 ---
            let html =
                `<span class="log-step">Step ${entry.step}:</span>` +
                `<span class="${meta.cls}">${meta.label}</span> ` +
                `<span class="${dirCls}">${dirLabel}</span>` +
                ` | Qty: ${qty.toFixed(4)} @ ${price.toFixed(4)}` +
                ` | Value: ${tradeValue.toFixed(2)}` +
                ` | Fee: ${(Number(entry.fee) || 0).toFixed(2)}`;

            // --- PnL（减/平仓且非零时显示；盯市场景下通常为 0） ---
            if (shouldShowPnl) {
                const pnlClass = pnlVal >= 0 ? 'log-pnl-pos' : 'log-pnl-neg';
                html += ` | PnL: <span class="${pnlClass}">${formatPnl(pnlVal)}</span>`;
            }

            // --- 本步盯市盈亏（每日无负债结算） ---
            if (shouldShowSettled) {
                const settledClass = settledVal >= 0 ? 'log-pnl-pos' : 'log-pnl-neg';
                html += ` | MTM: <span class="${settledClass}">${formatPnl(settledVal)}</span>`;
            }

            // --- 期货模式：杠杆 + 保证金 ---
            if (useLeverage) {
                html += ` | Lev: ${(Number(entry.leverage) || 1).toFixed(2)}x`;
                if (Number(entry.margin) > 0) {
                    html += ` | Margin: ${Number(entry.margin).toFixed(2)}`;
                }
            }

            // --- 交易后持仓（自洽性关键字段） ---
            const posAfter = Number(entry.position_after) || 0;
            if (posAfter > 1e-9) {
                html += ` | → Pos: ${posAfter.toFixed(4)}`;
                if (Number(entry.avg_open_price_after) > 1e-9) {
                    html += ` @ ${Number(entry.avg_open_price_after).toFixed(4)}`;
                }
            } else {
                html += ` | → Flat`;
            }

            logEntry.innerHTML = html;
            container.appendChild(logEntry);
        });
    }

    // --- 渲染 Account History ---
    function renderAccountHistory(elementId, historyData) {
        const container = document.getElementById(elementId);
        if (!container) return;

        container.innerHTML = '';
        if (!historyData || historyData.length === 0) {
            container.innerHTML = '<div>No account history available.</div>';
            return;
        }

        const simCfg = (chartDataStore && chartDataStore.simulation_config) || {};
        const useLeverage = !!simCfg.use_leverage;

        historyData.forEach(entry => {
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry';
            if (entry.is_forced_close) {
                logEntry.classList.add('log-entry-danger');
            }

            const posDir = entry.position_direction || 'hold';
            const posClass = `log-pos-${posDir}`;
            const posLabel = posDir.toUpperCase();

            const totalAssets = Number(entry.total_assets) || 0;
            const cash = Number(entry.available_funds) || 0;
            const posMV = Number(entry.position_market_value) || 0;
            const margin = Number(entry.occupied_margin) || 0;
            const posQty = Number(entry.position_quantity) || 0;
            const avgPrice = Number(entry.avg_open_price) || 0;
            const uPnl = Number(entry.unrealized_pnl) || 0;
            const lev = Number(entry.leverage) || 1;
            const dd = Number(entry.drawdown) || 0;
            const settledVal = Number(entry.settled_pnl);
            const lockedProfit = Number(entry.locked_profit) || 0;

            // --- 基础字段：总资产 / 现金 ---
            let html =
                `<span class="log-step">Step ${entry.step}:</span>` +
                `Assets: ${totalAssets.toFixed(2)}` +
                ` | Cash: ${cash.toFixed(2)}`;

            // 锁定的浮盈
            if (lockedProfit > 1e-9) {
                html += ` | Locked: ${lockedProfit.toFixed(2)}`;
            }

            // --- 持仓市值（有持仓时展示） ---
            // 语义修正：此处原为 "Equity"，但实际展示的是 position_market_value，
            // 正确术语应为 PosMV (Position Market Value)。
            if (posMV > 1e-9) {
                html += ` | PosMV: ${posMV.toFixed(2)}`;
            }

            // --- 期货模式：占用保证金 ---
            if (useLeverage && margin > 1e-9) {
                html += ` | Margin: ${margin.toFixed(2)}`;
            }

            // --- 持仓方向 / 数量 / 均价 ---
            html += ` | Pos: <span class="${posClass}">${posLabel}</span>`;
            if (posQty > 1e-9) {
                html += ` (${posQty.toFixed(4)}`;
                if (avgPrice > 1e-9) {
                    html += ` @ ${avgPrice.toFixed(4)}`;
                }
                html += `)`;
            }

            // --- 未实现盈亏（仅持仓时有意义） ---
            if (posDir !== 'hold' && Math.abs(uPnl) > 1e-9) {
                const upnlClass = uPnl >= 0 ? 'log-pnl-pos' : 'log-pnl-neg';
                html += ` | uPnL: <span class="${upnlClass}">${formatPnl(uPnl)}</span>`;
            }

            // --- 本步盯市结算盈亏 ---
            if (entry.settled_pnl !== undefined
                && entry.settled_pnl !== null
                && Math.abs(settledVal) > 1e-9) {
                const settledClass = settledVal >= 0 ? 'log-pnl-pos' : 'log-pnl-neg';
                html += ` | MTM: <span class="${settledClass}">${formatPnl(settledVal)}</span>`;
            }

            // --- 期货模式：动态杠杆（持仓市值 / 占用保证金） ---
            if (useLeverage && posDir !== 'hold') {
                html += ` | dLev: ${lev.toFixed(2)}x`;
            }

            // --- 回撤（非零时展示） ---
            if (dd > 1e-9) {
                html += ` | DD: ${(dd * 100).toFixed(2)}%`;
            }

            // --- 强平事件标记 ---
            if (entry.is_forced_close) {
                html += ` | <span class="log-warn">[FORCED CLOSE]</span>`;
            }

            logEntry.innerHTML = html;
            container.appendChild(logEntry);
        });
    }

    // --- 初始化空图表 ---
    function initializeEmptyCharts() {
        renderChart(modelChart, 'Model Inference', [], [], [], [], []);
    }

    if (runButton) {
        runButton.addEventListener('click', fetchAndRender);
    } else {
        console.error("Run button not found!");
    }

    // 为置信度阈值和“Show Hold”开关添加事件监听器，
    // 当它们的值改变时，调用 rerenderCharts 函数重绘图表
    document.getElementById('confidence-threshold').addEventListener('input', rerenderCharts);
    document.getElementById('show-hold').addEventListener('change', rerenderCharts);

    // 避免首次加载时显示空图表
    initializeEmptyCharts();

    setEmptyModelResults();

    // --- 信息提示栏的点击交互 ---
    const infoItems = document.querySelectorAll('.info-item');

    infoItems.forEach(item => {
        const currentTooltip = item.querySelector('.info-tooltip');

        // 如果这个 .info-item 内部没有 .info-tooltip (比如 Public API 链接)，
        // 则不为它添加切换弹窗的点击事件
        if (!currentTooltip) {
            return;
        }

        // 只为有 tooltip 的项添加点击事件
        item.addEventListener('click', function(event) {
            event.stopPropagation(); // 阻止事件冒泡，防止立即被 document 监听器关闭

            const isCurrentlyShown = currentTooltip.classList.contains('show');

            // 1. 先关闭所有其他打开的 tooltips
            document.querySelectorAll('.info-tooltip.show').forEach(tt => {
                if (tt !== currentTooltip) {
                    tt.classList.remove('show');
                }
            });

            // 2. 切换当前点击的 tooltip
            currentTooltip.classList.toggle('show', !isCurrentlyShown);
        });
    });

    // --- 点击页面空白处关闭所有 tooltips ---
    document.addEventListener('click', function(event) {
        // 检查点击的是否是 info-item 或 tooltip 内部
        if (!event.target.closest('.info-item')) {
            document.querySelectorAll('.info-tooltip.show').forEach(tt => {
                tt.classList.remove('show');
            });
        }
    });

    window.addEventListener('resize', () => {
        modelChart.resize();
    });
});
