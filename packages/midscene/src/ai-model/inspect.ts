import assert from 'node:assert';
import type {
  AIAssertionResponse,
  AIElementResponse,
  AISectionParseResponse,
  AISingleElementResponse,
  AISingleElementResponseByPosition,
  AIUsageInfo,
  BaseElement,
  ElementById,
  ElementTreeNode,
  Size,
  UIContext,
} from '@/types';
import type {
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources';
import { AIActionType, callAiFn } from './common';
import {
  findElementPrompt,
  systemPromptToLocateElement,
} from './prompt/llm-locator';
import {
  describeUserPage,
  elementByPositionWithElementInfo,
  extractDataPrompt,
  systemPromptToAssert,
  systemPromptToExtract,
} from './prompt/util';
import { callToGetJSONObject } from './service-caller';

export type AIArgs = [
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
];

const liteContextConfig = {
  filterNonTextContent: true,
  truncateTextLength: 200,
};

function transformToAbsoluteCoords(
  relativePosition: { x: number; y: number },
  size: Size,
) {
  return {
    x: Number(((relativePosition.x / 1000) * size.width).toFixed(3)),
    y: Number(((relativePosition.y / 1000) * size.height).toFixed(3)),
  };
}

// let index = 0;
export async function transformElementPositionToId(
  aiResult: AIElementResponse | [number, number],
  treeRoot: ElementTreeNode<BaseElement>,
  size: { width: number; height: number },
) {
  if (Array.isArray(aiResult)) {
    const relativePosition = aiResult;
    const absolutePosition = transformToAbsoluteCoords(
      {
        x: relativePosition[0],
        y: relativePosition[1],
      },
      size,
    );

    const element = elementByPositionWithElementInfo(
      treeRoot,
      absolutePosition,
    );
    assert(
      element,
      `inspect: no id found with position: ${JSON.stringify({ absolutePosition })}`,
    );

    return {
      errors: [],
      elements: [
        {
          id: element.id,
        },
      ],
    };
  }

  return {
    errors: aiResult.errors,
    elements: aiResult.elements,
  };
}

function getQuickAnswer(
  quickAnswer:
    | Partial<AISingleElementResponse>
    | Partial<AISingleElementResponseByPosition>
    | undefined,
  tree: ElementTreeNode<BaseElement>,
  elementById: ElementById,
  insertElementByPosition: (position: { x: number; y: number }) => BaseElement,
) {
  if (!quickAnswer) {
    return undefined;
  }
  if ('id' in quickAnswer && quickAnswer.id && elementById(quickAnswer.id)) {
    return {
      parseResult: {
        elements: [quickAnswer],
        errors: [],
      },
      rawResponse: quickAnswer,
      elementById,
    };
  }

  if ('position' in quickAnswer && quickAnswer.position) {
    let element = elementByPositionWithElementInfo(tree, quickAnswer.position);
    if (!element) {
      element = insertElementByPosition(quickAnswer.position);
    }
    return {
      parseResult: {
        elements: [element],
        errors: [],
      },
      rawResponse: quickAnswer,
      elementById,
    } as any;
  }
}

export async function AiInspectElement<
  ElementType extends BaseElement = BaseElement,
>(options: {
  context: UIContext<ElementType>;
  multi: boolean;
  targetElementDescription: string;
  callAI?: typeof callAiFn<AIElementResponse | [number, number]>;
  quickAnswer?: Partial<
    AISingleElementResponse | AISingleElementResponseByPosition
  >;
}): Promise<{
  parseResult: AIElementResponse;
  rawResponse: any;
  elementById: ElementById;
  usage?: AIUsageInfo;
}> {
  const { context, multi, targetElementDescription, callAI } = options;
  const { screenshotBase64, screenshotBase64WithElementMarker } = context;
  const { description, elementById, insertElementByPosition, size } =
    await describeUserPage(context);
  // meet quick answer
  const quickAnswer = getQuickAnswer(
    options.quickAnswer,
    context.tree,
    elementById,
    insertElementByPosition,
  );
  if (quickAnswer) {
    return quickAnswer;
  }

  assert(
    targetElementDescription,
    'cannot find the target element description',
  );

  const userInstructionPrompt = await findElementPrompt.format({
    pageDescription: description,
    targetElementDescription,
    multi,
  });
  const systemPrompt = systemPromptToLocateElement();
  const msgs: AIArgs = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: screenshotBase64WithElementMarker || screenshotBase64,
            detail: 'high',
          },
        },
        {
          type: 'text',
          text: userInstructionPrompt,
        },
      ],
    },
  ];

  const callAIFn =
    callAI || callToGetJSONObject<AIElementResponse | [number, number]>;

  const res = await callAIFn(msgs, AIActionType.INSPECT_ELEMENT);
  return {
    parseResult: await transformElementPositionToId(
      res.content,
      context.tree,
      size,
    ),
    rawResponse: res.content,
    elementById,
    usage: res.usage,
  };
}

export async function AiExtractElementInfo<
  T,
  ElementType extends BaseElement = BaseElement,
>(options: {
  dataQuery: string | Record<string, string>;
  context: UIContext<ElementType>;
}) {
  const { dataQuery, context } = options;
  const systemPrompt = systemPromptToExtract();

  const { screenshotBase64 } = context;
  const { description, elementById } = await describeUserPage(
    context,
    liteContextConfig,
  );

  let dataKeys = '';
  let dataQueryText = '';
  if (typeof dataQuery === 'string') {
    dataKeys = '';
    dataQueryText = dataQuery;
  } else {
    dataKeys = `return in key-value style object, keys are ${Object.keys(dataQuery).join(',')}`;
    dataQueryText = JSON.stringify(dataQuery, null, 2);
  }
  const extractDataPromptText = await extractDataPrompt.format({
    pageDescription: description,
    dataKeys,
    dataQuery: dataQueryText,
  });

  const msgs: AIArgs = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: screenshotBase64,
            detail: 'high',
          },
        },
        {
          type: 'text',
          text: extractDataPromptText,
        },
      ],
    },
  ];

  const result = await callAiFn<AISectionParseResponse<T>>(
    msgs,
    AIActionType.EXTRACT_DATA,
  );
  return {
    parseResult: result.content,
    elementById,
    usage: result.usage,
  };
}

export async function AiAssert<
  ElementType extends BaseElement = BaseElement,
>(options: { assertion: string; context: UIContext<ElementType> }) {
  const { assertion, context } = options;

  assert(assertion, 'assertion should be a string');

  const { screenshotBase64 } = context;
  const systemPrompt = systemPromptToAssert();

  const msgs: AIArgs = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: screenshotBase64,
            detail: 'high',
          },
        },
        {
          type: 'text',
          text: `
Here is the description of the assertion. Just go ahead:
=====================================
${assertion}
=====================================
  `,
        },
      ],
    },
  ];

  const { content: assertResult, usage } = await callAiFn<AIAssertionResponse>(
    msgs,
    AIActionType.ASSERT,
  );
  return {
    content: assertResult,
    usage,
  };
}
