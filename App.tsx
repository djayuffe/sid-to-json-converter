import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileJson, Download, Music, AlertCircle, CheckCircle2, ArrowRight, Settings, List, Activity, Terminal } from 'lucide-react';
import { SidPlayer } from './services/sid/SidPlayer';
import { SidDump } from './services/sid/SidTypes';
import { JsonToMidiConverter, MidiConversionOptions } from './services/sid/JsonToMidi';
import { SystemLogger, LogEntry } from './services/Logger';

const App = () => {
  // SID -> JSON State
  const [sidFile, setSidFile] = useState<File | null>(null);
  const [loadingSid, setLoadingSid] = useState(false);
  const [sidError, setSidError] = useState<string | null>(null);
  const [sidResult, setSidResult] = useState<SidDump | null>(null);
  const [duration, setDuration] = useState(60);
  const [subtune, setSubtune] = useState(1);

  // JSON -> MIDI State
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [midiBlob, setMidiBlob] = useState<Blob | null>(null);
  const [loadingMidi, setLoadingMidi] = useState(false);
  const [showRegisters, setShowRegisters] = useState(false);

  // Debug State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // MIDI Options
  const [midiOpts, setMidiOpts] = useState<MidiConversionOptions>({
      quantize: 'none',
      useExpression: true,
      fullAutomation: true,
      mergeGaps: true,
      minNoteFrames: 1,
      octaveShift: 0,
      detectDrums: true,
      noteDuration: 'smart',
      convertArpsToChords: false
  });

  // Subscribe to Logger with buffering to prevent render thrashing
  useEffect(() => {
    let buffer: LogEntry[] = [];

    // Flush buffer every 100ms
    const intervalId = setInterval(() => {
      if (buffer.length > 0) {
        setLogs(prev => {
          // Keep strictly the last 1000 logs to prevent memory issues
          const newLogs = [...prev, ...buffer];
          return newLogs.length > 1000 ? newLogs.slice(-1000) : newLogs;
        });
        buffer = [];
      }
    }, 100);

    const unsub = SystemLogger.subscribe((entry) => {
        buffer.push(entry);
    });

    return () => {
        unsub();
        clearInterval(intervalId);
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
      if (logEndRef.current) {
          logEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
  }, [logs]);

  // Effect: "Automagic" - When SID result arrives, auto-generate MIDI
  useEffect(() => {
    if (sidResult && !loadingSid) {
        generateMidiFromDump(sidResult);
    }
  }, [sidResult, midiOpts]);

  // --- SID Processing ---
  const handleSidFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSidFile(e.target.files[0]);
      setSidError(null);
      setSidResult(null);
      setMidiBlob(null);
    }
  };

  const processSid = async () => {
    if (!sidFile) return;

    setLoadingSid(true);
    setSidError(null);
    setSidResult(null);
    setMidiBlob(null);
    SystemLogger.clear();
    setLogs([]); // Clear local logs

    try {
      const buffer = await sidFile.arrayBuffer();
      // Use setTimeout to allow UI to render the "Emulating..." state before blocking
      setTimeout(() => {
        try {
          const player = new SidPlayer();
          const dump = player.convertToJSON(buffer, duration, subtune);
          setSidResult(dump);
        } catch (err: any) {
          setSidError(err.message || "Failed to process SID file");
          SystemLogger.log('App', err.message, 'error');
        } finally {
          setLoadingSid(false);
        }
      }, 100);
    } catch (err) {
      setSidError("Failed to read file");
      setLoadingSid(false);
    }
  };

  const downloadJson = () => {
    if (!sidResult) return;
    const blob = new Blob([JSON.stringify(sidResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sidFile?.name.replace('.sid', '')}_dump.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- MIDI Processing ---
  const handleJsonFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setJsonFile(e.target.files[0]);
      setMidiBlob(null);
      setSidResult(null);
    }
  };

  const generateMidiFromDump = (dump: SidDump) => {
    setLoadingMidi(true);
    // Use setTimeout to unblock UI
    setTimeout(() => {
        try {
            const converter = new JsonToMidiConverter();
            const midiBytes = converter.convert(dump, midiOpts);
            const blob = new Blob([midiBytes], { type: 'audio/midi' });
            setMidiBlob(blob);
        } catch (err) {
            console.error("Failed to convert JSON:", err);
            SystemLogger.log('App', 'MIDI Generation Failed', 'error');
        } finally {
            setLoadingMidi(false);
        }
    }, 50);
  };

  const processJsonToMidiFile = async () => {
    if (!jsonFile) return;
    setLoadingMidi(true);
    try {
        const text = await jsonFile.text();
        const dump: SidDump = JSON.parse(text);
        generateMidiFromDump(dump);
    } catch (err) {
        alert("Failed to convert JSON file: " + err);
        setLoadingMidi(false);
    }
  };

  const downloadMidi = () => {
      if (!midiBlob) return;
      const url = URL.createObjectURL(midiBlob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = sidFile ? sidFile.name.replace('.sid', '') : jsonFile ? jsonFile.name.replace('.json', '') : 'output';
      a.download = `${fileName}.mid`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  // Helper to format hex
  const toHex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="text-center">
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 mb-4">
            SID Converter Suite
          </h1>
          <p className="text-slate-400 max-w-lg mx-auto">
            Cycle-stepped C64/SID register tracing for JSON and MIDI conversion.
          </p>
        </header>

        {/* Section 1: SID -> JSON */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 shadow-xl backdrop-blur-sm">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-cyan-400">
              <Music className="w-5 h-5" />
              1. SID to JSON
            </h2>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Select SID File
                </label>
                <div className="relative group">
                  <input
                    type="file"
                    accept=".sid"
                    onChange={handleSidFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${sidFile ? 'border-cyan-500/50 bg-cyan-900/10' : 'border-slate-600 hover:border-slate-500'}`}>
                    <Upload className={`w-8 h-8 mx-auto mb-2 ${sidFile ? 'text-cyan-400' : 'text-slate-500'}`} />
                    <p className="text-sm font-medium text-slate-300">
                      {sidFile ? sidFile.name : "Drop .sid file here"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Max Duration (s)</label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(Math.max(1, parseInt(e.target.value) || 60))}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-white focus:border-cyan-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Subtune</label>
                  <input
                    type="number"
                    value={subtune}
                    onChange={(e) => setSubtune(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-white focus:border-cyan-500 outline-none"
                  />
                </div>
              </div>

              {sidError && (
                  <div className="bg-red-900/20 border border-red-500/50 rounded p-3 flex items-start gap-2 text-sm text-red-300">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      {sidError}
                  </div>
              )}

              <button
                onClick={processSid}
                disabled={!sidFile || loadingSid}
                className={`w-full py-2 px-4 rounded font-bold text-white transition-all ${
                  !sidFile || loadingSid
                    ? 'bg-slate-700 cursor-not-allowed'
                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500'
                }`}
              >
                {loadingSid ? 'Emulating...' : 'Convert to JSON'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-6">
              {/* Debug Console */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-0 shadow-xl backdrop-blur-sm flex flex-col h-64 overflow-hidden">
                <div className="bg-slate-900 p-2 px-4 border-b border-slate-800 flex justify-between items-center">
                    <h2 className="text-xs font-bold text-slate-400 flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-orange-400" />
                        DEBUG CONSOLE
                    </h2>
                    <span className="text-[10px] text-slate-600">{logs.length} events</span>
                </div>
                <div className="flex-1 overflow-auto p-4 font-mono text-[10px] space-y-1 scrollbar-thin scrollbar-thumb-slate-700">
                    {logs.length === 0 && <span className="text-slate-700 italic">Ready for system output...</span>}
                    {logs.map((l, i) => (
                        <div key={i} className="flex gap-2">
                            <span className="text-slate-600">[{new Date(l.timestamp).toLocaleTimeString().split(' ')[0]}]</span>
                            <span className={`font-bold w-16 text-right ${l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-blue-400'}`}>{l.component}</span>
                            <span className={l.level === 'error' ? 'text-red-300' : 'text-slate-300'}>{l.message}</span>
                        </div>
                    ))}
                    <div ref={logEndRef} />
                </div>
              </div>

              {/* JSON Preview */}
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 shadow-xl backdrop-blur-sm flex flex-col flex-1">
                <div className="flex justify-between items-center mb-4">
                     <h2 className="text-sm font-semibold flex items-center gap-2 text-green-400">
                        <FileJson className="w-4 h-4" />
                        Result
                    </h2>
                    {sidResult && (
                        <div className="flex gap-2">
                             <button
                                onClick={() => setShowRegisters(!showRegisters)}
                                className="bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-xs text-slate-200 flex items-center gap-1"
                            >
                                <List className="w-3 h-3" /> Data
                            </button>
                            <button
                                onClick={downloadJson}
                                className="bg-green-700 hover:bg-green-600 px-2 py-1 rounded text-xs text-white flex items-center gap-1"
                            >
                                <Download className="w-3 h-3" /> Save
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1 bg-slate-900 rounded border border-slate-700 p-2 font-mono text-[10px] overflow-auto max-h-[150px] text-slate-400">
                     {sidResult ? (
                        <pre>
                        {JSON.stringify({
                            metadata: sidResult.metadata,
                            stats: `Converted ${sidResult.frameCount} frames (${sidResult.totalDuration.toFixed(1)}s)`
                        }, null, 2)}
                        </pre>
                    ) : (
                        <div className="text-center pt-8 opacity-50">No output yet</div>
                    )}
                </div>
              </div>
          </div>
        </div>

        {/* Register Inspector */}
        {sidResult && showRegisters && (
            <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl">
                <div className="bg-slate-800 p-3 border-b border-slate-700 flex justify-between items-center">
                    <h3 className="font-mono text-sm font-bold text-slate-300 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-cyan-400" />
                        Frame Data Inspector
                    </h3>
                </div>
                <div className="overflow-x-auto p-0 max-h-96">
                    <table className="w-full text-xs font-mono text-left border-collapse">
                        <thead className="bg-slate-800 text-slate-400 sticky top-0 shadow-lg">
                            <tr>
                                <th className="p-2 border-b border-slate-700 w-16 bg-slate-800">Frame</th>
                                <th className="p-2 border-b border-slate-700 bg-slate-800 text-center" colSpan={7}>Voice 1</th>
                                <th className="p-2 border-b border-slate-700 bg-slate-800 border-l border-slate-700 text-center" colSpan={7}>Voice 2</th>
                                <th className="p-2 border-b border-slate-700 bg-slate-800 border-l border-slate-700 text-center" colSpan={7}>Voice 3</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sidResult.frames.slice(0, 200).map((frame) => (
                                <tr key={frame.frame} className="hover:bg-slate-800/50 border-b border-slate-800/50">
                                    <td className="p-2 text-slate-500">{frame.frame}</td>
                                    {frame.registers.slice(0, 21).map((byte, idx) => (
                                        <td
                                            key={idx}
                                            className={`p-1 font-mono text-center ${
                                                idx % 7 === 4 ? 'text-yellow-400' :
                                                (idx % 7 === 0) && idx > 0 ? 'border-l border-slate-800' : ''
                                            }`}
                                        >
                                            {toHex(byte)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* Section 2: JSON -> MIDI */}
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-8">
            <div className="flex flex-col md:flex-row justify-between items-start mb-6 gap-4">
                <h2 className="text-2xl font-semibold flex items-center gap-3 text-purple-400">
                    <Music className="w-6 h-6" />
                    2. MIDI Conversion
                </h2>
                <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50 text-sm w-full md:w-auto">
                    <div className="grid grid-cols-2 md:flex flex-wrap gap-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-400">Quantization</label>
                            <select
                                value={midiOpts.quantize}
                                onChange={e => setMidiOpts({...midiOpts, quantize: e.target.value as any})}
                                className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none"
                            >
                                <option value="auto">Auto (Smart)</option>
                                <option value="1/32">1/32</option>
                                <option value="1/16">1/16</option>
                                <option value="1/16T">1/16 (Triplet)</option>
                                <option value="1/8">1/8</option>
                                <option value="1/8T">1/8 (Triplet)</option>
                                <option value="1/4">1/4</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-400">Octave Shift</label>
                            <select
                                value={midiOpts.octaveShift}
                                onChange={e => setMidiOpts({...midiOpts, octaveShift: parseInt(e.target.value)})}
                                className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none"
                            >
                                <option value="0">Auto</option>
                                <option value="-1">-1</option>
                                <option value="1">+1</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-400">Note Duration</label>
                            <select
                                value={midiOpts.noteDuration}
                                onChange={e => setMidiOpts({...midiOpts, noteDuration: e.target.value as any})}
                                className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none"
                            >
                                <option value="smart">Smart Detect</option>
                                <option value="audible">Audible (Tail)</option>
                                <option value="gate">Gate (Exact)</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-2 justify-center">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={midiOpts.detectDrums}
                                    onChange={e => setMidiOpts({...midiOpts, detectDrums: e.target.checked})}
                                    className="rounded border-slate-600 bg-slate-800 text-purple-500"
                                />
                                <label className="text-xs text-slate-300">Detect Drums</label>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={midiOpts.convertArpsToChords}
                                    onChange={e => setMidiOpts({...midiOpts, convertArpsToChords: e.target.checked})}
                                    className="rounded border-slate-600 bg-slate-800 text-purple-500"
                                />
                                <label className="text-xs text-slate-300">Convert Arps</label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-8 items-center">
                <div className="flex-1 w-full space-y-4">
                    {sidResult && !jsonFile ? (
                        <div className="border-2 border-purple-500/50 bg-purple-900/10 rounded-lg p-8 text-center relative">
                            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-purple-400" />
                            <p className="text-sm font-medium text-purple-200">
                                Using Emulated SID Data
                            </p>
                            <p className="text-xs text-purple-300/60 mt-1">
                                {sidResult.frames.length} frames ready
                            </p>
                            <button
                                onClick={() => document.getElementById('jsonUpload')?.click()}
                                className="absolute bottom-2 right-2 text-xs text-purple-400 hover:text-white underline"
                            >
                                Upload .json
                            </button>
                        </div>
                    ) : (
                        <div className="relative group">
                            <input
                                id="jsonUpload"
                                type="file"
                                accept=".json"
                                onChange={handleJsonFileChange}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            />
                            <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${jsonFile ? 'border-purple-500/50 bg-purple-900/10' : 'border-slate-600 hover:border-slate-500'}`}>
                                <FileJson className={`w-8 h-8 mx-auto mb-2 ${jsonFile ? 'text-purple-400' : 'text-slate-500'}`} />
                                <p className="text-sm font-medium text-slate-300">
                                    {jsonFile ? jsonFile.name : "Select JSON file"}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="hidden md:block">
                    <ArrowRight className="w-8 h-8 text-slate-600" />
                </div>

                <div className="flex-1 w-full flex flex-col gap-4">
                     {!midiBlob ? (
                         <button
                            onClick={jsonFile ? processJsonToMidiFile : () => sidResult && generateMidiFromDump(sidResult)}
                            disabled={(!jsonFile && !sidResult) || loadingMidi}
                            className={`w-full py-3 px-4 rounded-lg font-bold text-white transition-all ${
                                (!jsonFile && !sidResult) || loadingMidi
                                    ? 'bg-slate-700 cursor-not-allowed'
                                    : 'bg-purple-600 hover:bg-purple-500 shadow-lg shadow-purple-900/20'
                            }`}
                        >
                            {loadingMidi ? 'Converting...' : 'Convert to MIDI'}
                        </button>
                     ) : (
                         <div className="animate-in zoom-in duration-300">
                            <button
                                onClick={downloadMidi}
                                className="w-full py-3 px-4 rounded-lg font-bold text-white bg-green-600 hover:bg-green-500 shadow-lg shadow-green-900/20 flex items-center justify-center gap-2"
                            >
                                <Download className="w-5 h-5" />
                                Download .MID File
                            </button>
                            <div className="text-center mt-2">
                                <button
                                    onClick={() => setMidiBlob(null)}
                                    className="text-xs text-slate-500 hover:text-slate-300 underline"
                                >
                                    Reset / Convert Again
                                </button>
                            </div>
                        </div>
                     )}
                </div>
            </div>
        </div>

      </div>
    </div>
  );
};

export default App;
