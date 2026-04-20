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

  type AlimtalkCallback = (response: unknown) => void;

  function alimtalkSend(
    req: AlimtalkRequest,
    authData: AligoAuthData,
    callback?: AlimtalkCallback
  ): Promise<unknown> | void;

  const _default: {
    alimtalkSend: typeof alimtalkSend;
  };

  export = _default;
}
