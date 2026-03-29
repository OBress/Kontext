"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { GlowCard } from "@/app/components/shared/GlowCard";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";

interface LearnerStep {
  stepOrder: number;
  stepType: "content" | "guided_explore" | "quiz" | "acknowledgement";
  title: string;
  description: string;
  content: string;
  quizPayload?: {
    question?: string;
    options?: string[];
    correct_option_index?: number;
    explanation?: string;
  };
}

interface LearnerAttempt {
  id: number;
  stepOrder: number;
  attemptNumber: number;
  passed: boolean;
  score: number | null;
  createdAt: string;
}

interface LearnerExperience {
  mode: "assignment" | "preview" | "none";
  membershipRole: string;
  githubLogin: string | null;
  assignment: {
    id: number;
    status: string;
    progressPercent: number;
    currentStep: number;
    completedAt: string | null;
  } | null;
  template: {
    title: string;
    description: string | null;
    versionNumber: number;
    steps: LearnerStep[];
  } | null;
  attempts: LearnerAttempt[];
}

interface QuizFeedback {
  passed: boolean;
  explanation: string | null;
  correctOptionIndex: number;
}

export default function RepoOnboardingPage() {
  const params = useParams<{ owner: string; name: string }>();
  const repoFullName = `${params.owner}/${params.name}`;
  const [experience, setExperience] = useState<LearnerExperience | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [quizFeedback, setQuizFeedback] = useState<QuizFeedback | null>(null);

  const fetchExperience = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/repos/onboarding/me?repo=${encodeURIComponent(repoFullName)}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to load onboarding.");
      }
      setExperience(data as LearnerExperience);
      setCurrentStep(data.assignment?.currentStep || 0);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Failed to load onboarding.");
    } finally {
      setLoading(false);
    }
  }, [repoFullName]);

  useEffect(() => {
    fetchExperience();
  }, [fetchExperience]);

  const steps = experience?.template?.steps || [];
  const step = steps[currentStep] || null;
  const passedStepSet = useMemo(
    () =>
      new Set(
        (experience?.attempts || [])
          .filter((attempt) => attempt.passed)
          .map((attempt) => attempt.stepOrder)
      ),
    [experience?.attempts]
  );
  const attemptsForCurrentStep = useMemo(
    () =>
      (experience?.attempts || []).filter(
        (attempt) => attempt.stepOrder === currentStep
      ),
    [currentStep, experience?.attempts]
  );
  const currentQuizPassed = attemptsForCurrentStep.some((attempt) => attempt.passed);
  const isPreview = experience?.mode === "preview";
  const isAssignment = experience?.mode === "assignment";
  const canStart =
    isAssignment && experience?.assignment?.status === "assigned";

  useEffect(() => {
    setSelectedAnswer(null);
    setQuizFeedback(null);
  }, [currentStep]);

  const runAction = async (label: string, action: () => Promise<void>) => {
    setWorking(label);
    setMessage(null);
    try {
      await action();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setWorking(null);
    }
  };

  const patchProgress = async (
    action: "start" | "save_progress" | "complete",
    nextStep?: number
  ) => {
    const res = await fetch("/api/repos/onboarding/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo_full_name: repoFullName,
        action,
        current_step: nextStep,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || "Failed to update onboarding progress.");
    }
    setExperience(data as LearnerExperience);
    setCurrentStep(data.assignment?.currentStep || nextStep || 0);
  };

  const submitQuiz = async () => {
    if (selectedAnswer === null) return;

    await runAction("quiz", async () => {
      const res = await fetch("/api/repos/onboarding/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_full_name: repoFullName,
          action: "submit_quiz",
          step_order: currentStep,
          selected_option_index: selectedAnswer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to submit quiz.");
      }
      setQuizFeedback({
        passed: data.passed,
        explanation: data.explanation,
        correctOptionIndex: data.correctOptionIndex,
      });
      await fetchExperience();
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={22} className="animate-spin text-[var(--gray-500)]" />
      </div>
    );
  }

  if (!experience || experience.mode === "none" || !experience.template) {
    return (
      <div className="max-w-3xl">
        <GlowCard glowColor="none" className="p-6">
          <div className="flex items-center gap-3 mb-3">
            <ClipboardCheck size={18} className="text-[var(--gray-500)]" />
            <h2 className="font-mono text-lg text-[var(--gray-100)] m-0">
              Onboarding
            </h2>
          </div>
          <p className="font-mono text-sm text-[var(--gray-500)] m-0">
            No onboarding is assigned for this repo yet.
          </p>
          <div className="mt-4">
            <Link
              href={`/repo/${params.owner}/${params.name}/team`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono border border-[var(--alpha-white-8)] text-[var(--gray-300)] no-underline hover:bg-[var(--alpha-white-5)]"
            >
              Open Team & Onboarding Manager
              <ChevronRight size={12} />
            </Link>
          </div>
        </GlowCard>
      </div>
    );
  }

  const progressPercent = isPreview
    ? Math.round((currentStep / Math.max(steps.length - 1, 1)) * 100)
    : experience.assignment?.progressPercent || 0;

  const canContinue =
    !step ||
    step.stepType !== "quiz" ||
    isPreview ||
    currentQuizPassed ||
    quizFeedback?.passed;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-6">
      <GlowCard glowColor="none" className="p-4 h-fit">
        <div className="flex items-center gap-2 mb-2">
          <ClipboardCheck size={16} className="text-[var(--accent-green)]" />
          <h2 className="font-mono text-sm text-[var(--gray-100)] m-0">
            {experience.template.title}
          </h2>
        </div>
        <p className="font-mono text-xs text-[var(--gray-500)] m-0">
          {isPreview
            ? `Preview mode - version ${experience.template.versionNumber}`
            : `Assigned onboarding - ${experience.assignment?.status.replace("_", " ")}`}
        </p>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[10px] text-[var(--gray-500)] uppercase">
              Progress
            </span>
            <span className="font-mono text-[10px] text-[var(--accent-green)]">
              {progressPercent}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--alpha-white-8)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--accent-green)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {steps.map((entry, index) => (
            <button
              key={`${entry.title}-${index}`}
              onClick={() => setCurrentStep(index)}
              className={`w-full text-left rounded-lg px-3 py-2 border font-mono text-xs cursor-pointer ${
                index === currentStep
                  ? "border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--gray-100)]"
                  : "border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] text-[var(--gray-400)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span>{index + 1}. {entry.title}</span>
                {passedStepSet.has(index) ? (
                  <CheckCircle2 size={12} className="text-[var(--accent-green)]" />
                ) : null}
              </div>
            </button>
          ))}
        </div>
      </GlowCard>

      <GlowCard glowColor="purple" className="p-6">
        {step ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase text-[var(--accent-green)] m-0">
                  Step {currentStep + 1} of {steps.length}
                </p>
                <h3 className="font-mono text-xl text-[var(--gray-100)] mt-2 mb-1">
                  {step.title}
                </h3>
                <p className="font-mono text-sm text-[var(--gray-400)] m-0">
                  {step.description}
                </p>
              </div>
              <span className="px-2 py-1 rounded-full bg-[var(--alpha-white-5)] text-[var(--gray-400)] font-mono text-[10px] uppercase">
                {step.stepType.replace("_", " ")}
              </span>
            </div>

            {canStart ? (
              <div className="mt-6 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-5">
                <p className="font-mono text-sm text-[var(--gray-300)] m-0">
                  This onboarding has been assigned to you and is ready to start.
                </p>
                <button
                  onClick={() =>
                    runAction("start", async () => {
                      await patchProgress("start", currentStep);
                    })
                  }
                  disabled={working === "start"}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono bg-[var(--accent-green)] text-black font-medium border-none cursor-pointer disabled:opacity-40"
                >
                  {working === "start" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  Start Onboarding
                </button>
              </div>
            ) : (
              <>
                <div className="mt-6 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] p-5 whitespace-pre-wrap font-mono text-sm text-[var(--gray-300)] leading-6">
                  {step.content || "No content has been added for this step yet."}
                </div>

                {step.stepType === "quiz" && (
                  <div className="mt-5 rounded-xl border border-[var(--alpha-white-8)] bg-[var(--surface-1)] p-5">
                    <p className="font-mono text-sm text-[var(--gray-200)] m-0 mb-4">
                      {step.quizPayload?.question || "Review the walkthrough, then answer this check-in."}
                    </p>
                    <div className="space-y-2">
                      {(step.quizPayload?.options || []).map((option, index) => (
                        <label
                          key={`${option}-${index}`}
                          className="flex items-center gap-3 rounded-lg border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-3 py-3 font-mono text-xs text-[var(--gray-300)] cursor-pointer"
                        >
                          <input
                            type="radio"
                            checked={selectedAnswer === index}
                            onChange={() => setSelectedAnswer(index)}
                          />
                          <span>{option || `Option ${index + 1}`}</span>
                        </label>
                      ))}
                    </div>
                    <button
                      onClick={submitQuiz}
                      disabled={selectedAnswer === null || working === "quiz" || isPreview}
                      className="mt-4 px-4 py-2 rounded-lg text-xs font-mono bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20 cursor-pointer disabled:opacity-40"
                    >
                      {working === "quiz" ? "Checking..." : "Submit Answer"}
                    </button>

                    {(quizFeedback || currentQuizPassed) && (
                      <div className="mt-4 rounded-lg border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-3 py-3">
                        <p className="font-mono text-xs text-[var(--gray-200)] m-0">
                          {quizFeedback?.passed || currentQuizPassed
                            ? "Correct."
                            : "Not quite yet."}
                        </p>
                        {quizFeedback?.explanation && (
                          <p className="font-mono text-[11px] text-[var(--gray-500)] m-0 mt-2">
                            {quizFeedback.explanation}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {attemptsForCurrentStep.length > 0 && (
                  <div className="mt-4">
                    <p className="font-mono text-[10px] uppercase text-[var(--gray-500)] mb-2">
                      Attempts
                    </p>
                    <div className="space-y-2">
                      {attemptsForCurrentStep.map((attempt) => (
                        <div
                          key={attempt.id}
                          className="rounded-lg border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-3 py-2 flex items-center justify-between gap-3"
                        >
                          <span className="font-mono text-xs text-[var(--gray-300)]">
                            Attempt {attempt.attemptNumber}
                          </span>
                          <span
                            className={`font-mono text-[10px] ${
                              attempt.passed
                                ? "text-[var(--accent-green)]"
                                : "text-[var(--accent-amber)]"
                            }`}
                          >
                            {attempt.passed ? "Passed" : "Retry needed"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {!canStart && (
              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  onClick={() => setCurrentStep((value) => Math.max(0, value - 1))}
                  disabled={currentStep === 0}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono border border-[var(--alpha-white-8)] text-[var(--gray-300)] bg-transparent cursor-pointer disabled:opacity-30"
                >
                  <ChevronLeft size={12} />
                  Previous
                </button>

                <div className="flex items-center gap-2">
                  {currentStep < steps.length - 1 ? (
                    <button
                      onClick={() =>
                        runAction("progress", async () => {
                          const nextStep = currentStep + 1;
                          if (isPreview) {
                            setCurrentStep(nextStep);
                            return;
                          }
                          await patchProgress("save_progress", nextStep);
                        })
                      }
                      disabled={!canContinue || working === "progress"}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono bg-[var(--accent-green)] text-black font-medium border-none cursor-pointer disabled:opacity-40"
                    >
                      Next
                      <ChevronRight size={12} />
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        runAction("complete", async () => {
                          if (isPreview) {
                            setMessage("Preview complete. Publish and assign this onboarding from the Team tab.");
                            return;
                          }
                          await patchProgress("complete", currentStep);
                        })
                      }
                      disabled={working === "complete"}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono bg-[var(--accent-green)] text-black font-medium border-none cursor-pointer disabled:opacity-40"
                    >
                      <CheckCircle2 size={12} />
                      Complete Onboarding
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        ) : null}

        {message && (
          <div className="mt-5 rounded-lg border border-[var(--alpha-white-8)] bg-[var(--alpha-white-3)] px-4 py-3">
            <p className="font-mono text-xs text-[var(--gray-300)] m-0">{message}</p>
          </div>
        )}

        {isPreview && (
          <div className="mt-5 rounded-lg border border-[var(--accent-green)]/20 bg-[var(--accent-green)]/5 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={13} className="text-[var(--accent-green)]" />
              <span className="font-mono text-xs text-[var(--accent-green)]">
                Preview Mode
              </span>
            </div>
            <p className="font-mono text-[11px] text-[var(--gray-400)] m-0">
              This is how the assigned onboarding experience will look. Publish and attach it from the Team tab to use it with invites.
            </p>
          </div>
        )}
      </GlowCard>
    </div>
  );
}
