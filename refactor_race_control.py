import os
import re

file_path = r"d:\Projects\flightdriving\src\pages\RaceControl.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# We need to extract CompareModal and TrainingModal
# Since they are wrapped in an IIFE `(() => { ... })()`, we can just replace that block.

def extract_block(text, start_marker, end_marker):
    start_idx = text.find(start_marker)
    if start_idx == -1: return None, None, None
    end_idx = text.find(end_marker, start_idx)
    if end_idx == -1: return None, None, None
    end_idx += len(end_marker)
    return text[start_idx:end_idx], start_idx, end_idx

# 1. CompareModal
start_compare = "{showCompareModal && (() => {"
end_compare = "      })()}"
compare_code, s, e = extract_block(content, start_compare, end_compare)

if compare_code:
    # Replace in content
    content = content.replace(compare_code, "{showCompareModal && <CompareModal\n          compareDriverA={compareDriverA}\n          setCompareDriverA={setCompareDriverA}\n          compareDriverB={compareDriverB}\n          setCompareDriverB={setCompareDriverB}\n          sortedLaps={sortedLaps}\n          telemetry={telemetry}\n          uniqueDrivers={uniqueDrivers}\n          setShowCompareModal={setShowCompareModal}\n          buildMonotonicSpline={buildMonotonicSpline}\n        />}")
    
    # Save CompareModal
    compare_component = f"""import React from 'react';
import {{ motion }} from 'framer-motion';

interface CompareModalProps {{
  compareDriverA: string;
  setCompareDriverA: (val: string) => void;
  compareDriverB: string;
  setCompareDriverB: (val: string) => void;
  sortedLaps: any[];
  telemetry: any[];
  uniqueDrivers: any[];
  setShowCompareModal: (val: boolean) => void;
  buildMonotonicSpline: (pts: {{x: number, y: number}}[]) => string;
}}

export function CompareModal({{
  compareDriverA, setCompareDriverA,
  compareDriverB, setCompareDriverB,
  sortedLaps, telemetry, uniqueDrivers,
  setShowCompareModal, buildMonotonicSpline
}}: CompareModalProps) {{
{compare_code.replace("{showCompareModal && (() => {", "").replace("})()}", "")}
}}
"""
    with open(r"d:\Projects\flightdriving\src\components\RaceControl\CompareModal.tsx", "w", encoding="utf-8") as f:
        f.write(compare_component)

# 2. TrainingModal
start_training = "{showTrainingModal && (() => {"
end_training = "      })()}"
training_code, s, e = extract_block(content, start_training, end_training)

if training_code:
    content = content.replace(training_code, "{showTrainingModal && <TrainingModal\n          trainingDriver={trainingDriver}\n          setTrainingDriver={setTrainingDriver}\n          trainingLapAId={trainingLapAId}\n          setTrainingLapAId={setTrainingLapAId}\n          trainingLapBId={trainingLapBId}\n          setTrainingLapBId={setTrainingLapBId}\n          driverLaps={driverLaps}\n          tracks={tracks}\n          selectedTrack={selectedTrack}\n          uniqueDrivers={uniqueDrivers}\n          setShowTrainingModal={setShowTrainingModal}\n          buildMonotonicSpline={buildMonotonicSpline}\n          calculateTrackCorners={calculateTrackCorners}\n        />}")

    training_component = f"""import React from 'react';
import {{ motion }} from 'framer-motion';

interface TrainingModalProps {{
  trainingDriver: string;
  setTrainingDriver: (val: string) => void;
  trainingLapAId: string;
  setTrainingLapAId: (val: string) => void;
  trainingLapBId: string;
  setTrainingLapBId: (val: string) => void;
  driverLaps: any[];
  tracks: any[];
  selectedTrack: string;
  uniqueDrivers: any[];
  setShowTrainingModal: (val: boolean) => void;
  buildMonotonicSpline: (pts: {{x: number, y: number}}[]) => string;
  calculateTrackCorners: (path: any) => any;
}}

export function TrainingModal({{
  trainingDriver, setTrainingDriver,
  trainingLapAId, setTrainingLapAId,
  trainingLapBId, setTrainingLapBId,
  driverLaps, tracks, selectedTrack, uniqueDrivers,
  setShowTrainingModal, buildMonotonicSpline, calculateTrackCorners
}}: TrainingModalProps) {{
{training_code.replace("{showTrainingModal && (() => {", "").replace("})()}", "")}
}}
"""
    with open(r"d:\Projects\flightdriving\src\components\RaceControl\TrainingModal.tsx", "w", encoding="utf-8") as f:
        f.write(training_component)

# Add imports to RaceControl.tsx
import_statements = """import { CompareModal } from '../components/RaceControl/CompareModal';
import { TrainingModal } from '../components/RaceControl/TrainingModal';
"""
content = content.replace("import { calculateTrackCorners } from '../lib/math';", "import { calculateTrackCorners } from '../lib/math';\n" + import_statements)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Done extracting modals!")
