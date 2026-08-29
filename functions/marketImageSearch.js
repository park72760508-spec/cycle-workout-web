/**
 * 중고랜드 이미지 검색 — CLIP(ViT-B/32) 임베딩 계산 헬퍼.
 *
 * 검색(조회) 자체는 브라우저에서 직접 계산한 임베딩으로 Supabase RPC(match_products_by_image)를
 * 호출하므로 서버를 거치지 않는다(assets/js/market/marketScreen.js 참고). 이 파일은 "등록 시
 * 상품 이미지를 색인(=임베딩 계산 후 market_items.embedding에 저장)"하는, 서버에서만 할 수 있는
 * 부분만 담당한다 — service role 키로 RLS를 우회해 써야 하고, 업로더의 브라우저 성능/네트워크
 * 상태에 기대지 않고 항상 동일한 결과를 보장해야 하기 때문이다.
 *
 * 모델은 함수 인스턴스가 살아있는 동안(warm) 재사용되도록 모듈 스코프에 캐시한다(Singleton).
 * @huggingface/transformers는 ESM 전용 패키지라 CommonJS인 이 파일에서는 동적 import()로 불러온다.
 */

const MARKET_CLIP_MODEL_ID = "Xenova/clip-vit-base-patch32";
const MARKET_CLIP_EMBEDDING_DIM = 512;

let visionPipelinePromise = null;

/** processor + vision 모델을 최초 1회만 로드해 캐시한다(콜드스타트 이후 재사용). */
function loadMarketClipVisionPipeline() {
  if (!visionPipelinePromise) {
    visionPipelinePromise = import("@huggingface/transformers").then(async (mod) => {
      const [processor, visionModel] = await Promise.all([
        mod.AutoProcessor.from_pretrained(MARKET_CLIP_MODEL_ID),
        mod.CLIPVisionModelWithProjection.from_pretrained(MARKET_CLIP_MODEL_ID, { dtype: "q8" }),
      ]);
      return { RawImage: mod.RawImage, processor, visionModel };
    });
  }
  return visionPipelinePromise;
}

function l2Normalize(values) {
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) sumSq += values[i] * values[i];
  const norm = Math.sqrt(sumSq) || 1;
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / norm;
  return out;
}

/**
 * 공개 이미지 URL(Supabase Storage market-images 버킷)로부터 512차원 정규화 임베딩을 계산한다.
 * @param {string} imageUrl
 * @returns {Promise<number[]>}
 */
async function computeMarketImageEmbeddingFromUrl(imageUrl) {
  const { RawImage, processor, visionModel } = await loadMarketClipVisionPipeline();
  const image = await RawImage.read(imageUrl);
  const inputs = await processor(image);
  const { image_embeds } = await visionModel(inputs);
  const values = Array.from(image_embeds.data);
  if (values.length !== MARKET_CLIP_EMBEDDING_DIM) {
    throw new Error("예상치 못한 임베딩 차원: " + values.length);
  }
  return l2Normalize(values);
}

module.exports = {
  MARKET_CLIP_MODEL_ID,
  MARKET_CLIP_EMBEDDING_DIM,
  computeMarketImageEmbeddingFromUrl,
};
