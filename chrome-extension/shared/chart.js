// 原生 Canvas K 线图，避免引入任何图表库，保持插件足够轻量。
import { round } from "./utils.js";

export function drawCandles(canvas, candles = []) {
  // 显示最近 45 根 K 线，同时叠加 MA5、BBI 和成交量柱。
  if (!canvas || !candles.length) {
    return;
  }

  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const priceHeight = Math.floor(height * 0.72);
  const volumeHeight = height - priceHeight;
  const visible = candles.slice(-45);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const highs = visible.map((item) => item.high);
  const lows = visible.map((item) => item.low);
  const volumes = visible.map((item) => item.volume);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const maxVolume = Math.max(...volumes, 1);
  const barWidth = width / visible.length;

  context.strokeStyle = "#e9edf3";
  context.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = (priceHeight / 4) * i;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  visible.forEach((item, index) => {
    const x = index * barWidth + barWidth / 2;
    const openY = mapPriceToY(item.open, maxPrice, minPrice, priceHeight);
    const closeY = mapPriceToY(item.close, maxPrice, minPrice, priceHeight);
    const highY = mapPriceToY(item.high, maxPrice, minPrice, priceHeight);
    const lowY = mapPriceToY(item.low, maxPrice, minPrice, priceHeight);
    const color = item.close >= item.open ? "#d63b2f" : "#1c8c4b";

    context.strokeStyle = color;
    context.beginPath();
    context.moveTo(x, highY);
    context.lineTo(x, lowY);
    context.stroke();

    const bodyY = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
    context.fillStyle = color;
    context.fillRect(x - barWidth * 0.28, bodyY, barWidth * 0.56, bodyHeight);

    const volumeY = priceHeight + volumeHeight - (item.volume / maxVolume) * (volumeHeight - 10);
    context.globalAlpha = 0.42;
    context.fillRect(x - barWidth * 0.28, volumeY, barWidth * 0.56, priceHeight + volumeHeight - volumeY);
    context.globalAlpha = 1;
  });

  drawLine(context, visible, "ma5", "#e67e22", maxPrice, minPrice, priceHeight, barWidth);
  drawLine(context, visible, "bbi", "#2f6fed", maxPrice, minPrice, priceHeight, barWidth);

  context.fillStyle = "#5a6473";
  context.font = "12px Segoe UI";
  context.fillText(`高 ${round(maxPrice, 2)}`, 8, 16);
  context.fillText(`低 ${round(minPrice, 2)}`, 8, priceHeight - 8);
}

function drawLine(context, visible, field, color, maxPrice, minPrice, priceHeight, barWidth) {
  context.strokeStyle = color;
  context.lineWidth = 1.6;
  context.beginPath();
  let started = false;

  visible.forEach((item, index) => {
    if (item[field] === null || item[field] === undefined) {
      return;
    }
    const x = index * barWidth + barWidth / 2;
    const y = mapPriceToY(item[field], maxPrice, minPrice, priceHeight);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();
}

function mapPriceToY(price, maxPrice, minPrice, chartHeight) {
  const spread = Math.max(maxPrice - minPrice, 0.01);
  return ((maxPrice - price) / spread) * (chartHeight - 12) + 8;
}

export function drawIntradayLine(canvas, points = [], prevClose = 0) {
  if (!canvas || !points.length) {
    const context = canvas?.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    return;
  }

  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const chartHeight = Math.floor(height * 0.72);
  const volumeHeight = height - chartHeight;
  const prices = points.map((item) => item.price);
  const avgPrices = points.map((item) => item.avgPrice).filter(Boolean);
  const volumes = points.map((item) => item.volume);
  const minPrice = Math.min(...prices, ...(avgPrices.length ? avgPrices : prices), prevClose || Infinity);
  const maxPrice = Math.max(...prices, ...(avgPrices.length ? avgPrices : prices), prevClose || 0);
  const maxVolume = Math.max(...volumes, 1);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#e8edf5";
  context.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = (chartHeight / 4) * i;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  if (prevClose > 0) {
    const y = mapPriceToY(prevClose, maxPrice, minPrice, chartHeight);
    context.setLineDash([4, 4]);
    context.strokeStyle = "#9aa5b5";
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    context.setLineDash([]);
  }

  drawIntradaySeries(context, points, width, chartHeight, minPrice, maxPrice, "price", "#d63b2f");
  drawIntradaySeries(context, points, width, chartHeight, minPrice, maxPrice, "avgPrice", "#2f6fed");

  const barWidth = Math.max(width / points.length, 1);
  points.forEach((item, index) => {
    const x = index * barWidth;
    const barHeight = (item.volume / maxVolume) * (volumeHeight - 10);
    context.fillStyle = item.price >= prevClose ? "rgba(214,59,47,0.28)" : "rgba(28,140,75,0.28)";
    context.fillRect(x, height - barHeight, Math.max(barWidth - 1, 1), barHeight);
  });

  context.fillStyle = "#5a6473";
  context.font = "12px Segoe UI";
  context.fillText(`高 ${round(maxPrice, 2)}`, 8, 16);
  context.fillText(`低 ${round(minPrice, 2)}`, 8, chartHeight - 8);
  context.fillText(points[0].time.slice(11, 16), 8, height - 6);
  context.fillText(points[points.length - 1].time.slice(11, 16), width - 42, height - 6);
}

function drawIntradaySeries(context, points, width, chartHeight, minPrice, maxPrice, field, color) {
  context.strokeStyle = color;
  context.lineWidth = 1.6;
  context.beginPath();
  let started = false;
  const step = points.length > 1 ? width / (points.length - 1) : width;

  points.forEach((item, index) => {
    const value = item[field];
    if (!value) {
      return;
    }
    const x = step * index;
    const y = mapPriceToY(value, maxPrice, minPrice, chartHeight);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();
}
