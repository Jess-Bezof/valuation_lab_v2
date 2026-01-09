import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { X } from 'lucide-react';

const StockChart = ({ data = [], markers = [] }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);
    const [selectedNews, setSelectedNews] = useState<{ time: string; headline: string; color: string } | null>(null);

    // Combined Effect: Initialize Chart and Set Data/Markers together
    useEffect(() => {
        if (!chartContainerRef.current) return;
        
        // Cleanup previous instance
        if (chartRef.current) {
             chartRef.current.remove();
             chartRef.current = null;
        }

        const container = chartContainerRef.current;
        const width = container.clientWidth > 0 ? container.clientWidth : 800; 
        const height = 400;

        // 1. Create Chart
        const chart = createChart(container, {
            width: width,
            height: height,
            layout: { 
                background: { type: ColorType.Solid, color: '#0B0E14' },
                textColor: '#94a3b8' 
            },
            grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
            timeScale: { borderColor: '#1e293b', timeVisible: true },
            handleScroll: true,
            handleScale: true,
        });
        chartRef.current = chart;

        // 2. Create Series
        // Renaming to actualSeriesInstance to avoid conflict with the imported LineSeries class
        const actualSeriesInstance = chart.addSeries(LineSeries, { 
            color: '#3b82f6', 
            lineWidth: 2,
        }) as any;

        console.log('Type of series:', typeof actualSeriesInstance.setMarkers);

        let markersPlugin: any = null;
        let currentMappedMarkers: any[] = [];

        // 3. Set Data
        if (data && data.length > 0) {
            actualSeriesInstance.setData(data);
            
            // 4. Set Markers using v5 createSeriesMarkers plugin
            if (Array.isArray(markers) && markers.length > 0) {
                // Sort markers by time (ascending)
                const sortedMarkers = [...markers].sort((a: any, b: any) => 
                    (new Date(a.time).getTime() - new Date(b.time).getTime())
                );

                console.log('Markers applied using v5 createSeriesMarkers plugin');

                // Map markers to the format expected by lightweight-charts
                currentMappedMarkers = sortedMarkers.map((ev: any, index) => ({
                    time: ev.time,
                    position: ev.position || 'aboveBar',
                    color: ev.color || '#f59e0b',
                    shape: ev.shape || 'circle',
                    text: "", // Empty string to avoid cluttering the chart
                    // Map the AI summary (passed in 'headline' from backend) to the headline state for the summary box
                    headline: ev.headline || ev.text || 'No summary available',
                    originalIndex: index,
                    id: index // Adding an ID for reliable lookup if supported
                }));

                markersPlugin = createSeriesMarkers(actualSeriesInstance, currentMappedMarkers);
            }
            
            chart.timeScale().fitContent();
        }

        // 5. Subscribe to Click Events
        chart.subscribeClick((param) => {
            // Check if a marker was clicked (hoveredObjectId will be defined)
            if (param.hoveredObjectId === undefined) {
                setSelectedNews(null);
                return;
            }

            console.log('Marker clicked:', param.hoveredObjectId);

            // In v5 createSeriesMarkers, the hoveredObjectId corresponds to the 'id' property we passed
            // OR the index if no ID was provided. We passed 'id: index' explicitly.
            const markerId = param.hoveredObjectId as number;
            
            // Look up the marker in our local mapped array
            // Since we set id = index, we can just access it by index directly (or find it to be safe)
            const matchedMarker = currentMappedMarkers.find(m => m.id === markerId);

            if (matchedMarker) {
                 setSelectedNews({
                     time: matchedMarker.time,
                     headline: matchedMarker.headline,
                     color: matchedMarker.color
                 });
            } else {
                setSelectedNews(null);
            }
        });


        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
            chartRef.current = null;
        };
    }, [data, markers]); // Re-run if data or markers change

    return (
        <div className="relative">
            <div 
                ref={chartContainerRef} 
                className="rounded-xl overflow-hidden" 
                style={{ height: '400px', width: '100%', minHeight: '400px' }} 
            />
            
            {/* News Box Overlay */}
            {selectedNews && (
                <div className="absolute top-4 right-4 bg-slate-900 border border-slate-700 p-4 rounded-lg shadow-2xl max-w-sm z-50 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex justify-between items-start gap-4 mb-2">
                        <span className="text-xs font-mono text-slate-400">{selectedNews.time}</span>
                        <button 
                            onClick={() => setSelectedNews(null)}
                            className="text-slate-500 hover:text-white transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="flex items-start gap-3">
                        <div 
                            className="w-2 h-2 rounded-full mt-1.5 shrink-0" 
                            style={{ backgroundColor: selectedNews.color }}
                        />
                        <p className="text-sm text-slate-200 font-medium leading-relaxed">
                            {selectedNews.headline || 'Loading summary...'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export { StockChart };
