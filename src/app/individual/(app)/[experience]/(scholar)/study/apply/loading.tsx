import { StudyLoading } from "../_components/study-loading";
import { scholarSpace } from "@/lib/individual/scholar/spaces";

export default function Loading() {
  const s = scholarSpace("apply");
  return <StudyLoading title={s.title} eyebrow={s.eyebrow} />;
}
