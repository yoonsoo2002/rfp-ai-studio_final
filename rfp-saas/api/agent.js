const ALLOWED_MODELS = new Set(['gpt-4.1-mini', 'gpt-4.1', 'gpt-5']);

const roles = {
  research: `당신은 조사 담당 에이전트다. 업로드된 기획보고서에서 검증 가능한 사실을 추출한다. 숨겨진 사고과정은 출력하지 말고, 사용자에게 검토 가능한 작업 요약만 제공한다. JSON으로 {work_summary:string, findings:string[], evidence:string[], uncertainties:string[], handoff:string}을 반환한다. 사실을 지어내지 말고 출처 위치가 불명확하면 그렇게 표시한다.`,
  analysis: `당신은 분석 담당 에이전트다. 조사 담당의 결과를 IITP RFP 구조에 매핑한다. 숨겨진 사고과정 대신 결정 근거와 확인 필요 항목을 명시한다. JSON으로 {work_summary:string, mapping:string[], consistency_checks:string[], missing_info:string[], handoff:string, blueprint:object}을 반환한다.`,
  writer: `당신은 작성 담당 에이전트다. 분석 담당의 RFP blueprint와 조사 근거만 사용해 IITP RFP 초안을 작성한다. 각 섹션은 '□ 소제목' 3~6개와 상세 설명을 포함하고, 원문에 없는 수치·기관명·시장규모는 [사용자 확인 필요]로 표시한다. 숨겨진 사고과정은 출력하지 말고, JSON으로 {work_summary:string, writing_notes:string[], sections:[{id:string,title:string,text:string}]}을 반환한다.`
};

function responseText(data) {
  return (data.output || []).flatMap(item => item.content || []).map(item => item.text || '').join('').trim();
}

function parseJson(text) {
  return JSON.parse(text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'Vercel 환경변수 OPENAI_API_KEY가 설정되지 않았습니다.' });

  const { action, model, prompt, file, research, analysis } = req.body || {};
  if (!roles[action]) return res.status(400).json({ error: '지원하지 않는 에이전트 작업입니다.' });
  const selectedModel = ALLOWED_MODELS.has(model) ? model : 'gpt-4.1-mini';

  const userText = action === 'research'
    ? `RFP 유형: ${prompt?.rfpType || '품목공모형'}\n사용자 메모: ${prompt?.memo || '(없음)'}\n업로드 파일을 읽고 조사 결과를 반환하세요.`
    : action === 'analysis'
      ? `다음은 조사 담당의 실제 전달물입니다.\n${JSON.stringify(research)}\n\n이를 IITP RFP 구조로 분석하세요.`
      : `조사 담당 전달물:\n${JSON.stringify(research)}\n\n분석 담당 전달물:\n${JSON.stringify(analysis)}\n\n다음 7개 섹션으로 RFP를 작성하세요: 품목·문제 정의, 최종목표 및 단계별 목표, 현황 및 필요성, 수요분석 및 협력방안, 기대효과, 개발기간·예산·추진체계, 후속계획 및 과제특징.`;

  const content = [{ type: 'input_text', text: userText }];
  if (action === 'research' && file?.data && file?.name) {
    content.unshift({ type: 'input_file', filename: file.name, file_data: file.data });
  }

  try {
    const apiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: selectedModel,
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: roles[action] }] },
          { role: 'user', content }
        ],
        max_output_tokens: action === 'writer' ? 9000 : 4500
      })
    });
    const data = await apiResponse.json();
    if (!apiResponse.ok) return res.status(apiResponse.status).json({ error: data.error?.message || 'OpenAI API 요청에 실패했습니다.' });
    return res.status(200).json({ result: parseJson(responseText(data)) });
  } catch (error) {
    return res.status(500).json({ error: error.message || '에이전트 실행 중 오류가 발생했습니다.' });
  }
}
