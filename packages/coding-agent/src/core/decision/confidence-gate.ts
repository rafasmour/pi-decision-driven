import type { ClassifierAnswer, ClassifierQuestion } from "@earendil-works/pi-ai";

export interface LowConfidenceItem {
	questionId: string;
	confidence: number;
	margin: number;
}

function choiceMargin(probabilities: Record<string, number>): number {
	const sorted = Object.values(probabilities).sort((a, b) => b - a);
	if (sorted.length < 2) return sorted[0] ?? 1;
	return (sorted[0] ?? 0) - (sorted[1] ?? 0);
}

export function findLowConfidenceAnswers(
	_questions: Record<string, ClassifierQuestion>,
	answers: Record<string, ClassifierAnswer>,
	confidenceThreshold: number,
	marginThreshold = 0.15,
): LowConfidenceItem[] {
	const low: LowConfidenceItem[] = [];
	for (const [questionId, answer] of Object.entries(answers)) {
		if (answer.type === "choice") {
			const margin = choiceMargin(answer.probabilities);
			if (answer.confidence < confidenceThreshold || margin < marginThreshold) {
				low.push({ questionId, confidence: answer.confidence, margin });
			}
		} else if (answer.type === "bool") {
			const confidence = Math.max(answer.probability, 1 - answer.probability);
			if (confidence < confidenceThreshold) {
				low.push({ questionId, confidence, margin: Math.abs(answer.probability - 0.5) * 2 });
			}
		} else if (answer.type === "score") {
			if (answer.confidence < confidenceThreshold) {
				low.push({ questionId, confidence: answer.confidence, margin: 0 });
			}
		}
	}
	return low;
}
