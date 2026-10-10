import { randomUUID } from "node:crypto";
import { getFirebaseAdminDb } from "./firebaseAdmin.js";
import { getCoveredMonthKey, runManualMonthlyAssetAnalysis } from "./scheduledAnalysis.js";
const MONTHLY_JOB_LEASE_MS = 33e4;
function refs(db) {
  const portfolio = db.collection("portfolio").doc("app");
  return {
    jobs: portfolio.collection("monthlyAnalysisJobs"),
    locks: portfolio.collection("monthlyAnalysisJobLocks"),
    sessions: portfolio.collection("analysisSessions")
  };
}
function isMonthlyJobId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
async function startMonthlyAnalysisJob(requestedId = randomUUID(), dependencies = {}) {
  if (!isMonthlyJobId(requestedId)) throw new Error("\u6708\u5831\u5DE5\u4F5C\u7DE8\u865F\u7121\u6548\u3002");
  const db = dependencies.db ?? getFirebaseAdminDb();
  const now = (dependencies.now ?? Date.now)();
  const coveredMonthKey = getCoveredMonthKey(new Date(now));
  const { jobs, locks } = refs(db);
  const jobRef = jobs.doc(requestedId);
  const lockRef = locks.doc(coveredMonthKey);
  return db.runTransaction(async (transaction) => {
    const [requested, lock] = await Promise.all([transaction.get(jobRef), transaction.get(lockRef)]);
    if (requested.exists) {
      return { job: requested.data(), shouldRun: false };
    }
    const activeId = lock.data()?.jobId;
    if (typeof activeId === "string") {
      const active = await transaction.get(jobs.doc(activeId));
      const job2 = active.data();
      if (job2?.status === "running" && now - job2.startedAt < MONTHLY_JOB_LEASE_MS) {
        return { job: job2, shouldRun: false };
      }
    }
    const job = { id: requestedId, coveredMonthKey, status: "running", startedAt: now };
    transaction.set(jobRef, job);
    transaction.set(lockRef, { jobId: job.id });
    return { job, shouldRun: true };
  });
}
async function getMonthlyAnalysisJob(jobId, dependencies = {}) {
  const db = dependencies.db ?? getFirebaseAdminDb();
  const now = (dependencies.now ?? Date.now)();
  const { jobs, locks, sessions } = refs(db);
  if (!jobId) {
    const lock = await locks.doc(getCoveredMonthKey(new Date(now))).get();
    jobId = lock.data()?.jobId;
    if (!jobId) return null;
  }
  if (!isMonthlyJobId(jobId)) throw new Error("\u6708\u5831\u5DE5\u4F5C\u7DE8\u865F\u7121\u6548\u3002");
  const jobRef = jobs.doc(jobId);
  const snapshot = await jobRef.get();
  if (!snapshot.exists) return null;
  const job = snapshot.data();
  if (job.status !== "running" || now - job.startedAt < MONTHLY_JOB_LEASE_MS) return job;
  const baseId = `monthly-${job.coveredMonthKey}`;
  const candidates = await Promise.all([sessions.doc(baseId).get(), sessions.doc(`${baseId}-v2`).get()]);
  const saved = candidates.find((doc) => doc.data()?.generationJobId === job.id && typeof doc.data()?.result === "string" && doc.data().result.trim().length > 0);
  const finished = saved ? {
    ...job,
    status: "succeeded",
    finishedAt: now,
    sessionDocId: saved.id,
    isTimeoutFallback: saved.data()?.isTimeoutFallback === true,
    message: "\u6708\u5831\u5DF2\u5B8C\u6210\u4E26\u5132\u5B58\u3002"
  } : {
    ...job,
    status: "failed",
    finishedAt: now,
    message: "\u6708\u5831\u80CC\u666F\u5DE5\u4F5C\u903E\u6642\uFF0C\u672A\u78BA\u8A8D\u6709\u65B0\u5831\u544A\u5132\u5B58\u3002\u8ACB\u91CD\u65B0\u751F\u6210\u3002"
  };
  return db.runTransaction(async (transaction) => {
    const latest = await transaction.get(jobRef);
    const current = latest.data();
    if (current.status !== "running") return current;
    transaction.set(jobRef, finished);
    return finished;
  });
}
async function runMonthlyAnalysisJob(job, dependencies = {}) {
  const db = dependencies.db ?? getFirebaseAdminDb();
  const jobRef = refs(db).jobs.doc(job.id);
  const now = dependencies.now ?? Date.now;
  let result;
  try {
    if (getCoveredMonthKey(new Date(now())) !== job.coveredMonthKey) {
      throw new Error("\u5831\u544A\u6708\u4EFD\u5DF2\u5207\u63DB\uFF0C\u8ACB\u91CD\u65B0\u751F\u6210\u65B0\u6708\u4EFD\u6708\u5831\u3002");
    }
    result = await (dependencies.runAnalysis ?? runManualMonthlyAssetAnalysis)(job.id);
  } catch (error) {
    console.error("[monthlyAnalysisJob] failed", { jobId: job.id, error: error instanceof Error ? error.message : "unknown_error" });
    await jobRef.set({
      status: "failed",
      finishedAt: now(),
      message: error instanceof Error ? error.message : "\u6708\u5831\u751F\u6210\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002"
    }, { merge: true });
    return;
  }
  try {
    await jobRef.set({
      status: "succeeded",
      finishedAt: now(),
      sessionDocId: result.sessionDocId,
      isTimeoutFallback: result.isTimeoutFallback === true,
      message: result.message
    }, { merge: true });
    console.info("[monthlyAnalysisJob] completed", { jobId: job.id, sessionDocId: result.sessionDocId });
  } catch (error) {
    console.error("[monthlyAnalysisJob] completion status write failed", {
      jobId: job.id,
      error: error instanceof Error ? error.message : "unknown_error"
    });
  }
}
export {
  MONTHLY_JOB_LEASE_MS,
  getMonthlyAnalysisJob,
  isMonthlyJobId,
  runMonthlyAnalysisJob,
  startMonthlyAnalysisJob
};
