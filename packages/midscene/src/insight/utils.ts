import assert from 'node:assert';
import {
  MIDSCENE_MODEL_NAME,
  MIDSCENE_USE_VLM_UI_TARS,
  getAIConfig,
} from '@/env';
import type {
  DumpMeta,
  DumpSubscriber,
  InsightDump,
  PartialInsightDumpFromSDK,
} from '@/types';
import { getLogDir, getVersion, stringifyDumpData } from '@/utils';
import { uuid } from '@midscene/shared/utils';
const logContent: string[] = [];
const logIdIndexMap: Record<string, number> = {};

export function emitInsightDump(
  data: PartialInsightDumpFromSDK,
  logId?: string,
  dumpSubscriber?: DumpSubscriber,
): string {
  const logDir = getLogDir();
  assert(logDir, 'logDir should be set before writing dump file');

  const id = logId || uuid();
  const baseData: DumpMeta = {
    sdkVersion: getVersion(),
    logTime: Date.now(),
    model_name: getAIConfig(MIDSCENE_MODEL_NAME) || '',
    model_description: getAIConfig(MIDSCENE_USE_VLM_UI_TARS)
      ? 'vlm-ui-tars enabled'
      : '',
  };
  const finalData: InsightDump = {
    logId: id,
    ...baseData,
    ...data,
  };

  dumpSubscriber?.(finalData);

  const dataString = stringifyDumpData(finalData, 2);

  if (typeof logIdIndexMap[id] === 'number') {
    logContent[logIdIndexMap[id]] = dataString;
  } else {
    const length = logContent.push(dataString);
    logIdIndexMap[id] = length - 1;
  }

  return id;
}
