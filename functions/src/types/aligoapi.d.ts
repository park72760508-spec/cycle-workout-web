declare module "aligoapi" {
  interface AlimtalkRequestBody {
    senderkey: string;
    tpl_code: string;
    sender: string;
    receiver_1: string;
    subject_1: string;
    message_1: string;
  }

  interface AlimtalkRequest {
    body: AlimtalkRequestBody;
  }

  interface AligoAuthData {
    apikey: string;
    userid: string;
    token: string;
  }

  /** aligoapi 1.1.x: (req, auth)만 지원, 응답 JSON은 Promise로 반환 */
  function alimtalkSend(req: AlimtalkRequest, authData: AligoAuthData): Promise<unknown>;

  const _default: {
    alimtalkSend: typeof alimtalkSend;
  };

  export = _default;
}
