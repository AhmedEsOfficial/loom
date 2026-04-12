import { ulid } from "ulid";
import type {
  EpisodeId,
  GraphId,
  MapNodeId,
  NodeId,
  SkillId,
  TemplateId,
} from "../types/common.js";

export function newEpisodeId(): EpisodeId {
  return ulid() as EpisodeId;
}

export function newMapNodeId(): MapNodeId {
  return ulid() as MapNodeId;
}

export function newGraphId(): GraphId {
  return ulid() as GraphId;
}

export function newNodeId(): NodeId {
  return ulid() as NodeId;
}

export function newSkillId(): SkillId {
  return ulid() as SkillId;
}

export function newTemplateId(): TemplateId {
  return ulid() as TemplateId;
}

export function newId(): string {
  return ulid();
}
