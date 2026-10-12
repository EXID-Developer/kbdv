import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { SERIES } from '../../map/colors.ts';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface Bucket {
  label: string;
  /** Longer label for the tooltip. */
  title: string;
  count: number;
}

const INK_MUTED = '#8b96a8';
const GRID = '#232c39';
const AXIS = '#384252';

export function Timeline({ buckets, unit, scale }: { buckets: Bucket[]; unit: (n: number) => string; scale: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const chart = echarts.init(ref.current!, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current!);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const font = 13 * scale;
    chartRef.current?.setOption(
      {
        animationDuration: 500,
        textStyle: { fontFamily: "'Pretendard Variable', Pretendard, system-ui, sans-serif" },
        grid: { left: 8, right: 8, top: 14, bottom: 4, containLabel: true },
        tooltip: {
          trigger: 'axis',
          triggerOn: 'mousemove|click',
          axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.04)' } },
          backgroundColor: '#1c2430',
          borderColor: '#2c3748',
          textStyle: { color: '#e6ebf2', fontSize: font },
          formatter: (p: Array<{ dataIndex: number }>) => {
            const b = buckets[p[0].dataIndex];
            return `${b.title}<br/><b>${unit(b.count)}</b>`;
          },
        },
        xAxis: {
          type: 'category',
          data: buckets.map((b) => b.label),
          axisTick: { show: false },
          axisLine: { lineStyle: { color: AXIS } },
          axisLabel: { color: INK_MUTED, fontSize: font, hideOverlap: true },
        },
        yAxis: {
          type: 'value',
          minInterval: 1,
          splitNumber: 3,
          axisLabel: { color: INK_MUTED, fontSize: font },
          splitLine: { lineStyle: { color: GRID, width: 1 } },
        },
        series: [
          {
            type: 'bar',
            data: buckets.map((b) => b.count),
            barMaxWidth: 24,
            itemStyle: { color: SERIES, borderRadius: [4, 4, 0, 0] },
            emphasis: { itemStyle: { color: '#5598e7' } },
          },
        ],
      },
      true,
    );
  }, [buckets, unit, scale]);

  return <div ref={ref} style={{ width: '100%', height: '12rem' }} />;
}
