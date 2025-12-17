import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { ArrowDownTrayIcon, ArrowUpTrayIcon, PlayCircleIcon, StopIcon, MapIcon } from './icons';

interface MindMapRendererProps {
    chart: string;
}

const ZoomInIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
    </svg>
);

const ZoomOutIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM7.5 10.5h6" />
    </svg>
);

const RefreshIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
);

const ArrowsRightLeftIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
);

const ArrowDownIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
    </svg>
);

const MindMapRenderer: React.FC<MindMapRendererProps> = ({ chart }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [layout, setLayout] = useState<'LR' | 'TD'>('LR'); // Left-Right or Top-Down
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [renderError, setRenderError] = useState(false);

    useEffect(() => {
        mermaid.initialize({
            startOnLoad: false,
            theme: 'base',
            securityLevel: 'loose',
            fontFamily: 'inherit',
            themeVariables: {
                primaryColor: '#4f46e5',
                primaryTextColor: '#fff',
                primaryBorderColor: '#fff',
                lineColor: '#818cf8',
                secondaryColor: '#f472b6',
                tertiaryColor: '#fff'
            }
        });
    }, []);

    useEffect(() => {
        const renderChart = async () => {
            if (containerRef.current && chart) {
                try {
                    setRenderError(false);
                    // Unique ID for the diagram
                    const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
                    
                    // 1. Sanitize: Fix quotes
                    let safeChart = chart.replace(/\[([^"\]]+?)\]/g, '["$1"]');
                    
                    // 2. Structure: Replace 'graph LR' or 'graph TD' with current layout
                    safeChart = safeChart.replace(/^graph [A-Z]+/, `graph ${layout}`);
                    
                    // 3. Style Injection: 
                    // Use simple HEX colors in Mermaid to satisfy the parser.
                    // We will override these with CSS gradients in the DOM.
                    const styles = `
                        classDef default fill:#4f46e5,stroke:#fff,stroke-width:2px,color:white,rx:8,ry:8,font-weight:bold;
                        linkStyle default stroke:#818cf8,stroke-width:2px,fill:none;
                    `;
                    
                    // Append styles to the chart definition
                    const finalChart = `${safeChart}\n${styles}`;

                    // Clear previous
                    containerRef.current.innerHTML = '';
                    
                    const { svg } = await mermaid.render(id, finalChart);
                    
                    if (containerRef.current) {
                        containerRef.current.innerHTML = svg;
                        
                        // Post-processing to ensure SVG scales nicely in our zoom container
                        const svgElement = containerRef.current.querySelector('svg');
                        if (svgElement) {
                            svgElement.style.height = '100%';
                            svgElement.style.width = '100%';
                            svgElement.style.overflow = 'visible'; // Important for cropping issues
                        }
                    }
                } catch (error) {
                    console.error("Mermaid rendering failed:", error);
                    setRenderError(true);
                }
            }
        };

        renderChart();
    }, [chart, layout]);

    // Pan/Zoom Handlers
    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const scaleAmount = -e.deltaY * 0.001;
            setZoom(z => Math.max(0.2, Math.min(4, z + scaleAmount)));
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        // Set cursor
        if(containerRef.current) containerRef.current.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            e.preventDefault();
            setPan({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        if(containerRef.current) containerRef.current.style.cursor = 'grab';
    };

    const resetView = () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };

    return (
        <div className="flex flex-col h-[600px] border border-slate-200 rounded-xl bg-slate-50 overflow-hidden shadow-sm relative">
            
            {/* Gradient Definitions (Hidden SVG) */}
            <svg width="0" height="0" className="absolute pointer-events-none">
                <defs>
                    <linearGradient id="node-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#4f46e5" /> {/* Indigo 600 */}
                        <stop offset="100%" stopColor="#9333ea" /> {/* Purple 600 */}
                    </linearGradient>
                    <linearGradient id="line-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#818cf8" /> {/* Indigo 400 */}
                        <stop offset="100%" stopColor="#ef4444" /> {/* Red 500 */}
                    </linearGradient>
                </defs>
            </svg>
            
            {/* CSS overrides to apply gradients where Mermaid syntax fails */}
            <style>{`
                .mermaid-container .node rect, 
                .mermaid-container .node circle, 
                .mermaid-container .node polygon, 
                .mermaid-container .node path {
                    fill: url(#node-gradient) !important;
                }
                .mermaid-container .edgePath path,
                .mermaid-container .flowchart-link {
                    stroke: url(#line-gradient) !important;
                }
            `}</style>

            {/* Toolbar */}
            <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
                {/* Layout Controls */}
                <div className="bg-white p-1 rounded-lg shadow-md border border-slate-200 flex flex-col gap-1">
                    <button 
                        onClick={() => setLayout('LR')} 
                        className={`p-2 rounded-md transition-colors ${layout === 'LR' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'}`}
                        title="Flow Layout (Left-Right)"
                    >
                        <ArrowsRightLeftIcon />
                    </button>
                    <button 
                        onClick={() => setLayout('TD')} 
                        className={`p-2 rounded-md transition-colors ${layout === 'TD' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50'}`}
                        title="Tree Layout (Top-Down)"
                    >
                        <ArrowDownIcon />
                    </button>
                </div>

                {/* Zoom Controls */}
                <div className="bg-white p-1 rounded-lg shadow-md border border-slate-200 flex flex-col gap-1">
                    <button onClick={() => setZoom(z => Math.min(4, z + 0.2))} className="p-2 text-slate-600 hover:bg-slate-50 rounded-md" title="Zoom In">
                        <ZoomInIcon />
                    </button>
                    <button onClick={() => setZoom(z => Math.max(0.2, z - 0.2))} className="p-2 text-slate-600 hover:bg-slate-50 rounded-md" title="Zoom Out">
                        <ZoomOutIcon />
                    </button>
                    <button onClick={resetView} className="p-2 text-slate-600 hover:bg-slate-50 rounded-md" title="Reset View">
                        <RefreshIcon />
                    </button>
                </div>
            </div>

            {/* Viewport */}
            <div 
                className="flex-1 overflow-hidden relative bg-slate-50 cursor-grab active:cursor-grabbing"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
            >
                {/* Canvas */}
                <div 
                    className="w-full h-full flex items-center justify-center transition-transform duration-75 ease-out origin-center"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    }}
                >
                    <div ref={containerRef} className="mermaid-container" />
                </div>
                
                {renderError && (
                     <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-white/90 p-4 rounded-lg border border-red-200 text-red-600 shadow-lg text-sm font-medium">
                            Failed to render mind map structure.
                        </div>
                    </div>
                )}
            </div>
            
            {/* Status Bar */}
            <div className="bg-white border-t border-slate-200 px-4 py-2 text-xs text-slate-500 flex justify-between">
                <span>{layout === 'LR' ? 'Horizontal Flow' : 'Vertical Tree'}</span>
                <span>Zoom: {Math.round(zoom * 100)}%</span>
            </div>
        </div>
    );
};

export default MindMapRenderer;