// Dashboard 是完整盯盘工作台，负责自选股维护、个股查看、K 线展示和报告浏览。
import { drawCandles, drawIntradayLine } from "../shared/chart.js";
import { buildReportHtml, buildReportMarkdown } from "../shared/report.js";
import { ensureDefaults, getState, saveWatchlist } from "../shared/storage.js";
import { applyTheme, formatCurrency } from "../shared/ui.js";
import { formatDateTime, formatStockCode, inferMarket, escapeHtml } from "../shared/utils.js";

const watchForm = document.getElementById("watchForm");
const watchTable = document.getElementById("watchTable");
const quoteSummary = document.getElementById("quoteSummary");
const selectedTitle = document.getElementById("selectedTitle");
const reportRanking = document.getElementById("reportRanking");
const reportTimestamp = document.getElementById("reportTimestamp");
const reportOverview = document.getElementById("reportOverview");
const alertLogs = document.getElementById("alertLogs");
const klineCanvas = document.getElementById("klineCanvas");
const liveStatus = document.getElementById("liveStatus");
const showIntradayBtn = document.getElementById("showIntradayBtn");
const showDailyBtn = document.getElementById("showDailyBtn");

let selectedCode = null;
let bootstrappedRefresh = false;
let realtimeTimer = null;
let intradayTimer = null;
let intradayBySymbol = {};
let chartMode = "intraday";

document.getElementById("refreshBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "force-refresh" });
  await refreshIntradayForSelection(true);
  await render();
});

document.getElementById("reviewBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "run-review" });
  await render();
});

document.getElementById("exportMdBtn").addEventListener("click", async () => {
  const { reports } = await getState();
  if (!reports?.latest) {
    return;
  }
  downloadTextFile(
    `复盘报告-${reports.latest.generatedAt.slice(0, 10)}.md`,
    buildReportMarkdown(reports.latest),
    "text/markdown;charset=utf-8"
  );
});

document.getElementById("exportHtmlBtn").addEventListener("click", async () => {
  const { reports } = await getState();
  if (!reports?.latest) {
    return;
  }
  downloadTextFile(
    `复盘报告-${reports.latest.generatedAt.slice(0, 10)}.html`,
    buildReportHtml(reports.latest),
    "text/html;charset=utf-8"
  );
});

document.getElementById("optionsBtn").addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
});

showIntradayBtn.addEventListener("click", async () => {
  chartMode = "intraday";
  showIntradayBtn.classList.add("active-tab");
  showDailyBtn.classList.remove("active-tab");
  await refreshIntradayForSelection();
  await render();
});

showDailyBtn.addEventListener("click", async () => {
  chartMode = "daily";
  showDailyBtn.classList.add("active-tab");
  showIntradayBtn.classList.remove("active-tab");
  await render();
});

watchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(watchForm);
  const state = await getState();
  const code = formatStockCode(formData.get("code"));
  if (!code) {
    return;
  }

  const item = {
    code,
    market: inferMarket(code),
    name: String(formData.get("name") || code).trim(),
    costPrice: Number(formData.get("costPrice") || 0),
    positionQty: Number(formData.get("positionQty") || 0),
    takeProfitPrice: Number(formData.get("takeProfitPrice") || 0),
    stopLossPrice: Number(formData.get("stopLossPrice") || 0),
    note: String(formData.get("note") || "").trim()
  };

  const nextWatchlist = state.watchlist.filter((entry) => !(entry.code === code && entry.market === item.market));
  nextWatchlist.unshift(item);
  await saveWatchlist(nextWatchlist);
  watchForm.reset();
  selectedCode = code;
  await chrome.runtime.sendMessage({ type: "force-refresh" });
  await render();
});

chrome.storage.onChanged.addListener(() => {
  render();
});

document.addEventListener("visibilitychange", () => {
  restartRealtimeLoop();
});

window.addEventListener("beforeunload", () => {
  stopRealtimeLoop();
});

render();

async function render() {
  // 每次重绘都按当前选中股票更新行情摘要和图表。
  await ensureDefaults();
  const state = await getState();
  applyTheme(state.settings);

  if (!bootstrappedRefresh) {
    bootstrappedRefresh = true;
    chrome.runtime.sendMessage({ type: "soft-refresh" }).catch(() => {});
    restartRealtimeLoop();
    refreshIntradayForSelection(true).catch(() => {});
  }

  if (!selectedCode && state.watchlist[0]) {
    selectedCode = state.watchlist[0].code;
  }

  watchTable.innerHTML = state.watchlist
    .map((stock) => {
      const symbol = `${stock.market}${stock.code}`;
      const quote = state.marketCache?.quotes?.[symbol];
      const hasQuote = Boolean(quote && quote.price > 0);
      return `
        <div class="watch-row" data-symbol="${escapeHtml(symbol)}">
          <div>
            <strong>${escapeHtml(stock.name)}</strong>
            <div class="muted">${escapeHtml(stock.code)} | 现价 ${hasQuote ? formatCurrency(quote.price) : "—（无数据）"}</div>
          </div>
          <div>
            <button data-code="${escapeHtml(stock.code)}" data-market="${escapeHtml(stock.market)}" class="ghost-btn select-btn">查看</button>
            <button data-code="${escapeHtml(stock.code)}" data-market="${escapeHtml(stock.market)}" class="ghost-btn delete-btn">删除</button>
          </div>
        </div>
      `;
    })
    .join("");

  watchTable.querySelectorAll(".select-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      selectedCode = button.dataset.code;
      await refreshIntradayForSelection(true);
      await render();
    });
  });

  watchTable.querySelectorAll(".delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const deleteCode = button.dataset.code;
      const deleteMarket = button.dataset.market;
      const nextWatchlist = state.watchlist.filter((item) => !(item.code === deleteCode && item.market === deleteMarket));
      await saveWatchlist(nextWatchlist);
      if (selectedCode === deleteCode) {
        selectedCode = nextWatchlist[0]?.code || null;
      }
      await render();
    });
  });

  const selectedStock = state.watchlist.find((item) => item.code === selectedCode) || state.watchlist[0];
  const symbol = selectedStock ? `${selectedStock.market}${selectedStock.code}` : null;
  const quote = symbol ? state.marketCache?.quotes?.[symbol] : null;
  const history = symbol ? state.marketCache?.histories?.[symbol] || [] : [];
  const quoteUpdatedAt = symbol ? state.marketCache?.quoteUpdatedAtBySymbol?.[symbol] : null;
  const intraday = symbol ? intradayBySymbol[symbol] || [] : [];

  selectedTitle.textContent = selectedStock
    ? `${selectedStock.name} ${selectedStock.code}`
    : "请选择一只股票";
  liveStatus.textContent = selectedStock
    ? `实时盯盘已开启 | 最新报价 ${quoteUpdatedAt ? formatDateTime(new Date(quoteUpdatedAt)) : "等待拉取"} | 轮询约 5 秒`
    : "未连接实时行情";

  quoteSummary.innerHTML = selectedStock
    ? `
        <div class="metric-card"><div class="label">现价</div><div class="value">${formatCurrency(quote?.price)}</div></div>
        <div class="metric-card"><div class="label">涨跌幅</div><div class="value" style="color:${Number(quote?.changePct) >= 0 ? "var(--accent-up)" : "var(--accent-down)"}">${Number(quote?.changePct || 0).toFixed(2)}%</div></div>
        <div class="metric-card"><div class="label">5日均线</div><div class="value">${formatCurrency(history.at(-1)?.ma5)}</div></div>
        <div class="metric-card"><div class="label">BBI</div><div class="value">${formatCurrency(history.at(-1)?.bbi)}</div></div>
        <div class="metric-card"><div class="label">持仓盈亏</div><div class="value">${formatCurrency((quote?.price - selectedStock.costPrice) * (selectedStock.positionQty || 0))}</div></div>
      `
    : "";

  if (chartMode === "intraday" && intraday.length) {
    drawIntradayLine(klineCanvas, intraday, Number(quote?.prevClose || history.at(-2)?.close || history.at(-1)?.open || 0));
  } else {
    drawCandles(klineCanvas, history);
  }

  const latestReport = state.reports?.latest;
  reportTimestamp.textContent = latestReport?.generatedAtText || "未生成";
  reportOverview.innerHTML = latestReport
    ? `满分 ${latestReport.totalPossibleScore} 分 | 最高分 ${latestReport.overview.topScore} 分 | 平均分 ${latestReport.overview.avgScore} 分 | 强势标的 ${latestReport.overview.strongCount} 只 | 弱势标的 ${latestReport.overview.weakCount} 只`
    : "点击“生成复盘”后，这里会给出整组自选股的强弱分布摘要。";
  reportRanking.innerHTML = latestReport?.ranking?.length
    ? latestReport.ranking
        .map(
          (item) => `
            <div class="report-item">
              <div>
                <strong>${item.rank}. ${escapeHtml(item.name)}</strong>
                <div class="muted">${escapeHtml(item.code)} | 现价 ${formatCurrency(item.currentPrice)}</div>
              </div>
              <div>
                <div class="tag up">${Number(item.totalScore || 0)}分</div>
                <div class="muted">${escapeHtml(item.matched.map((rule) => rule.ruleName).join("、") || "暂无")}</div>
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="alert-item"><div class="muted">点击“生成复盘”后，这里会按得分高低展示完整排名。</div></div>`;

  alertLogs.innerHTML = state.alertLogs?.length
    ? state.alertLogs
        .slice(0, 20)
        .map(
          (item) => `
            <div class="alert-item">
              <div>
                <strong>${escapeHtml(item.stockName)}</strong>
                <div class="muted">${escapeHtml(item.ruleName)}</div>
              </div>
              <div>
                <div class="tag ${Number(item.currentChangePct) >= 0 ? "up" : "down"}">${formatCurrency(item.currentPrice)}</div>
                <div class="muted">${escapeHtml(new Date(item.triggeredAt).toLocaleString())}</div>
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="alert-item"><div class="muted">最近还没有触发新的预警。</div></div>`;
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function restartRealtimeLoop() {
  stopRealtimeLoop();
  if (document.visibilityState !== "visible") {
    return;
  }

  realtimeTimer = window.setInterval(async () => {
    await chrome.runtime.sendMessage({ type: "realtime-refresh" }).catch(() => {});
  }, 5000);

  intradayTimer = window.setInterval(async () => {
    await refreshIntradayForSelection();
  }, 15000);
}

function stopRealtimeLoop() {
  if (realtimeTimer) {
    clearInterval(realtimeTimer);
    realtimeTimer = null;
  }
  if (intradayTimer) {
    clearInterval(intradayTimer);
    intradayTimer = null;
  }
}

async function refreshIntradayForSelection(force = false) {
  const state = await getState();
  const selectedStock = state.watchlist.find((item) => item.code === selectedCode) || state.watchlist[0];
  if (!selectedStock) {
    return;
  }
  const symbol = `${selectedStock.market}${selectedStock.code}`;
  if (!force && chartMode !== "intraday") {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "get-intraday-trends",
    code: selectedStock.code,
    market: selectedStock.market,
    ndays: 1
  }).catch(() => null);

  if (response?.ok && Array.isArray(response.data)) {
    intradayBySymbol[symbol] = response.data;
    if (chartMode === "intraday") {
      await render();
    }
  }
}
