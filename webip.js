/*
 * (C) Copyright 2023 Kurento (https://chatbot.opsnow.com/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
(function (module, global) {
var theWsProtocol = "wip";
var theWipVersion = "0.1";
var theTimeout = [3000, 60000];
var theAudioDvc;

const theWipMsg =
{
  INIT_SESSION:       "InitSession",
  INIT_SESSION_REPLY: "InitSessionReply",
  PING:               "Ping",
  PONG:               "Pong",
  INVITE:             "Invite",
  PROCEED:            "Proceed",
  ACCEPT:             "Accept",
  CONNECT:            "Connect",
  CANDIDATE:          "Candidate",
  BYE:                "Bye",
  DISCONNECT:         "Disconnect",
  REJECT:             "Reject",
  CANCEL:             "Cancel"
};

function gGetUuid()
{
  let uuid;
  if(typeof self.crypto.randomUUID === 'function')
    uuid = self.crypto.randomUUID();
  else if(typeof crypto.getRandomValues === 'function')
    uuid = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  else
  {
    uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,  function(c) {
                                                                      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                                                                      return v.toString(16);
                                                                    }); 
  }
  return uuid;
}

class Queue
{
  constructor()
  {
    this._arr = [];
  }
  Count()
  {
    return this._arr.length;
  }
  Clear()
  {
    this._arr.length = 0;
  }
  Push(item)
  {
    this._arr.push(item);
  }
  Pop()
  {
    return this._arr.shift();
  }
};

/////////////////////////////////////////////////////////////////////////////////////////
// WebSocket State Machine Implement
/////////////////////////////////////////////////////////////////////////////////////////
const theWsSt = 
{
  WSC_NONE:         -1,
  WSC_CONNECTING:   0,
  WSC_CONNECTED:    1,
  WSC_RECONNECTING: 2
};

class MWsStateMc
{
  constructor(nWs)
  {
    this.mnWs = nWs;
  }
  getStateStr()
  {
    switch(this.mnWs)
    {
    case theWsSt.WSC_NONE:          return "WSC_NONE";
    case theWsSt.WSC_CONNECTING:    return "WSC_CONNECTING";
    case theWsSt.WSC_CONNECTED:     return "WSC_CONNECTED";
    case theWsSt.WSC_RECONNECTING:  return "WSC_RECONNECTING";
    }
    return "UNKNOWN";
  }
  logWarnWs(strFunc, jMsg)
  {
    if(jMsg)
      console.log("[WARNING] " + strFunc + "(" + jMsg.type + ") 처리할 수 없는 상태 입니다. [현재상태: " + this.getStateStr() + "(" + this.mnWs + ")]");
    else
      console.log("[WARNING] " + strFunc + " 처리할 수 없는 상태 입니다. [현재상태: " + this.getStateStr() + "(" + this.mnWs + ")]");
    return false;
  }
  changeState(iDlg, iNewSt)
  {
    console.log("[INFO] WeSocket 상태 전환: [" + this.getStateStr() + " => " + iNewSt.getStateStr() + "]");
    iDlg.miWsStMc = iNewSt;
    switch(iDlg.miWsStMc.mnWs)
    {
    case theWsSt.WSC_NONE:
      iDlg.miWipStMc.WsClose(iDlg);
      iDlg.WsRelease();
      break;
    case theWsSt.WSC_CONNECTED:
      iDlg.miWipStMc.WsConnect(iDlg);
      break;
    }
    return true;
  }
  ConnectSession(iDlg)              { return this.logWarnWs("ConnectSession"); }
  InitSession(iDlg)                 { return this.logWarnWs("InitSession"); }
  InitSessionReply(iDlg, jMsg)      { return this.logWarnWs("InitSessionReply"); }
  SendPing(iDlg)                    { return this.logWarnWs("SendPing"); }
  RecvPong(iDlg)                    { return this.logWarnWs("RecvPong"); }
  Processing(iDlg, nCmd, jMsg)      { return this.logWarnWs("Processing", jMsg); }
  ReconnectSession(iDlg)            { return this.logWarnWs("ReconnectSession"); }
  CloseSession(iDlg)                { return this.logWarnWs("CloseSession"); }
  WsTimeout(iDlg)                   { return this.logWarnWs("WsTimeout"); }
};

class MWsNone extends MWsStateMc
{
  constructor()
  {
    super(theWsSt.WSC_NONE);
  }
  ConnectSession(iDlg)
  {
    console.log("[INFO] MWsNone::ConnectSession");
    iDlg.miWs = new WebSocket(iDlg.mstrWsUrl, theWsProtocol);
    if(!iDlg.miWs)
    {
      console.log("[ERROR] Create webSocket instance failed!!");
      return false;
    }
    return this.changeState(iDlg, theWsConI);
  }
};

class MWsConnecting extends MWsStateMc
{
  constructor()
  {
    super(theWsSt.WSC_CONNECTING);
  }
  InitSession(iDlg)
  {
    console.log("[INFO] MWsNone::InitSession");
    var jMsg =
    {
      type:     theWipMsg.INIT_SESSION,
      version:  theWipVersion
    };
    if(!iDlg.SendMsg(jMsg))
    {
      console.log("[ERROR] Send message failed!! [" + jMsg + "]");
      CloseSession(iDlg);
      return false;
    }
    iDlg.mtWsId = setTimeout( function()
                              {
                                iDlg.WsTimeout();
                              }, 1000);
    return true;
  }
  InitSessionReply(iDlg, jMsg)
  {
    console.log("[INFO] MWsConnecting::InitSessionReply");
    if(iDlg.mtWsId)
    {
      clearTimeout(iDlg.mtWsId);
      iDlg.mtWsId = 0;
    }
    iDlg.mnTokenId = jMsg.token_id;
    iDlg.mnKaInterval = jMsg.ka_interval;
    iDlg.mtKa = setInterval(  function()
                              {
                                iDlg.SendPing();
                              }, iDlg.mnKaInterval);
    return this.changeState(iDlg, theWsConD);
  }
  CloseSession(iDlg)
  {
    console.log("[INFO] MWsConnecting::CloseSession");
    return this.changeState(iDlg, theWsNone);
  }
  WsTimeout(iDlg)
  {
    console.log("[INFO] MWsConnecting::WsTimeout");
    return this.changeState(iDlg, theWsNone);
  }
};

const theWipCmd = 
{
  WIP_MAKE_CALL:  0,
  WIP_SEMD_MSG:   1,
  WIP_RECV_MSG:   2,
  WIP_TIMEOUT:    3
};
class MWsConnected extends MWsStateMc
{
  constructor()
  {
    super(theWsSt.WSC_CONNECTED);
  }
  PongTimeout(iDlg)
  {
    if(++iDlg.mnWsToCnt > 3)
    {
      console.log("[WARN] PONG Timeout!! [" + iDlg.mnWsToCnt + "] - CloseSession");
      this.ReconnectSession(iDlg);
      return false;
    }
    else
      console.log("[WARN] PONG Timeout!! [" + iDlg.mnWsToCnt + "]");
    return true;
  }
  SendPing(iDlg)
  {
    var jMsg =
    {
      type:     theWipMsg.PING,
      version:  theWipVersion,
      token_id: iDlg.mnTokenId
    };
    if(!iDlg.SendMsg(jMsg))
    {
      console.log("[ERROR] Send PING message failed!! [" + jMsg + "]");
      return false;
    }
    if(iDlg.mtWsId)
    {
      clearTimeout(iDlg.mtWsId);
      iDlg.mtWsId = 0;
      if(!PongTimeout(iDlg))
        return false;
    }
    iDlg.mtWsId = setTimeout(this.PongTimeout, theTimeout[0], iDlg);
    console.log("setTimeout: [iDlg.mtWsId=" + iDlg.mtWsId + "]");
    return true;
  }
  RecvPong(iDlg)
  {
    return iDlg.RecvPong();
  }

  Processing(iDlg, nCmd, jMsg)
  {
    console.log("[INFO] MWsConnected::Processing");
    var bRet = false;
    switch(nCmd)
    {
    case theWipCmd.WIP_MAKE_CALL: bRet = iDlg.miWipStMc.MakeCall(iDlg);
      break;
    case theWipCmd.WIP_SEMD_MSG:
      switch(jMsg.type)
      {
      case theWipMsg.INVITE:      bRet = iDlg.miWipStMc.Invite(iDlg, jMsg, nCmd);    break;
      case theWipMsg.PROCEED:     bRet = iDlg.miWipStMc.Proceed(iDlg, jMsg);         break;
      case theWipMsg.ACCEPT:      bRet = iDlg.miWipStMc.Accept(iDlg, jMsg);          break;
      case theWipMsg.CONNECT:     bRet = iDlg.miWipStMc.Connect(iDlg, jMsg);         break;
      case theWipMsg.CANDIDATE:   bRet = iDlg.miWipStMc.Candidate(iDlg, jMsg, nCmd); break;
      case theWipMsg.BYE:         bRet = iDlg.miWipStMc.ByeSend(iDlg, jMsg);         break;
      case theWipMsg.DISCONNECT:  bRet = iDlg.miWipStMc.Disconnect(iDlg, jMsg);      break;
      case theWipMsg.REJECT:      bRet = iDlg.miWipStMc.Reject(iDlg, jMsg);          break;
      case theWipMsg.CANCEL:      bRet = iDlg.miWipStMc.Cancel(iDlg, jMsg);          break;
      default:  console.log("[WARNING] 지원하지 않는 송신 메시지 타입 [" + jMsg.type + "]"); break;
      }
      break;
    case theWipCmd.WIP_RECV_MSG:
      switch(jMsg.type)
      {
      case theWipMsg.INVITE:      bRet = iDlg.miWipStMc.Invite(iDlg, jMsg, nCmd);    break;
      case theWipMsg.PROCEED:     bRet = iDlg.miWipStMc.Proceed(iDlg, jMsg);         break;
      case theWipMsg.ACCEPT:      bRet = iDlg.miWipStMc.Accept(iDlg, jMsg);          break;
      case theWipMsg.CONNECT:     bRet = iDlg.miWipStMc.Connect(iDlg, jMsg);         break;
      case theWipMsg.CANDIDATE:   bRet = iDlg.miWipStMc.Candidate(iDlg, jMsg, nCmd); break;
      case theWipMsg.BYE:         bRet = iDlg.miWipStMc.ByeRecv(iDlg, jMsg);         break;
      case theWipMsg.DISCONNECT:  bRet = iDlg.miWipStMc.Disconnect(iDlg, jMsg);      break;
      case theWipMsg.REJECT:      bRet = iDlg.miWipStMc.Reject(iDlg, jMsg);          break;
      case theWipMsg.CANCEL:      bRet = iDlg.miWipStMc.Cancel(iDlg, jMsg);          break;
      default:  console.log("[WARNING] 지원하지 않는 수신 메시지 타입 [" + jMsg.type + "]"); break;
      }
      break;
    case theWipCmd.WIP_TIMEOUT:   bRet = iDlg.miWipStMc.Timeout(iDlg);
      break;
    default: console.log("[WARNING] 지원하지 않는 WIP 명령 [" + nCmd + "]");
      break;
    }
    return bRet;
  }
  ReconnectSession(iDlg)
  {
    console.log("[INFO] MWsConnected::ReconnectSession");
    if(iDlg.mtKa != null)
    {
      clearInterval(iDlg.mtKa);
      iDlg.mtKa = null;
    }
    if(iDlg.mtWsId)
    {
      clearTimeout(iDlg.mtWsId);
      iDlg.mtWsId = 0;
      iDlg.mnWsToCnt = 0;
    }
    if(!module.CbUnforeseenWebSocketDisconnect(iDlg.mnIdx, iDlg.mnRetryCnt))
      return false;
    this.changeState(iDlg, theWsReCo);
    return iDlg.WsReconnect(iDlg);
  }
  CloseSession(iDlg)
  {
    console.log("[INFO] MWsConnected::CloseSession");
    this.changeState(iDlg, theWsNone);
    return true;
  }
};

class MWsReconnecting extends MWsStateMc
{
  constructor()
  {
    super(theWsSt.WSC_RECONNECTING);
  }
  ReconnectSession(iDlg)
  {
    console.log("[INFO] MWsReconnecting::ReconnectSession");
    iDlg.mnRetryCnt++;
    iDlg.miWs = new WebSocket(iDlg.mstrWsUrl, theWsProtocol);
    if(iDlg.miWs == null)
    {
      console.log("[WARNING] Create webSocket instance failed!! [try=" + iDlg.mnWsToCnt+1 + "]");
      if(++iDlg.mnWsToCnt > 3)
      {
        console.log("[WARNING] Create webSocket instance failed!! - CloseSession");
        this.CloseSession(iDlg);
        return false;
      }
      iDlg.mtWsId = setTimeout( function()
                                {
                                  console.log("Timer" +  iDlg);
                                  iDlg.WsReconnect();
                                }, 1000);
      return false;
    }
    return true;
  }
  InitSession(iDlg)
  {
    console.log("[INFO] MWsReconnecting::InitSession");
    iDlg.mnWsToCnt = 0;
    var jMsg =
    {
      type:     theWipMsg.INIT_SESSION,
      version:  theWipVersion,
      token_id: iDlg.mnTokenId
    };
    if(!iDlg.SendMsg(jMsg))
    {
      console.log("[ERROR] Send message failed!! [" + jMsg + "]");
      CloseSession(iDlg);
      return false;
    }
    iDlg.mtWsId = setTimeout( function()
                              {
                                iDlg.WsTimeout();
                              }, 1000);
    return true;
  }
  InitSessionReply(iDlg, jMsg)
  {
    console.log("[INFO] MWsReconnecting::InitSessionReply");
    if(iDlg.mnTokenId != jMsg.token_id)
    {
      console.log("[WARN] Refresh Token ID [old=" + iDlg.mnTokenId + ", new=" + jMsg.token_id + "]");
      iDlg.miWipStMc.WsClose(iDlg);
    }
    iDlg.mnTokenId = jMsg.token_id;
    iDlg.mnKaInterval = jMsg.ka_interval;
    this.changeState(iDlg, theWsConD);
    iDlg.SendStoredMsg();
    /*
    while(iDlg.mqSendMsg.Count() > 0)
    {
      var jPkt = iDlg.mqSendMsg.Pop();
      if(jPkt)
        iDlg.SendMsg(jPkt);
    }
    */
    return true;
  }
  CloseSession(iDlg)
  {
    console.log("[INFO] MWsReconnecting::CloseSession");
    this.changeState(iDlg, theWsNone);
    return true;
  }
};

var theWsNone = new MWsNone();
var theWsConI = new MWsConnecting();
var theWsConD = new MWsConnected();
var theWsReCo = new MWsReconnecting();

/////////////////////////////////////////////////////////////////////////////////////////
// Call(WIP) State Machine Implement
/////////////////////////////////////////////////////////////////////////////////////////
const theWipSt = 
{
  WDS_UA_NONE:           -1,
  WDS_UA_NULL:           0,
  WDS_UA_TERMINATED:     1,
  WDS_UAC_MAKING:        100,
  WDS_UAC_CALLING:       101,
  WDS_UAC_PROCEEDING:    102,
  WDS_UAC_ACCEPTED:      103,
  WDS_UAC_ESTABLISHED:   104,
  WDS_UAC_DISCONNECTING: 105,
  WDS_UAS_DISCONNECTED:  204
}

class MWipStateMc
{
  constructor(nWds)
  {
    this.mnWds = nWds;
  }
  getStateStr()
  {
    switch(this.mnWds)
    {
    case theWipSt.WDS_UA_NONE:           return "WDS_UA_NONE";
    case theWipSt.WDS_UA_NULL:           return "WDS_UA_NULL";
    case theWipSt.WDS_UA_TERMINATED:     return "WDS_UA_TERMINATED";
    case theWipSt.WDS_UAC_MAKING:        return "WDS_UAC_MAKING";
    case theWipSt.WDS_UAC_CALLING:       return "WDS_UAC_CALLING";
    case theWipSt.WDS_UAC_PROCEEDING:    return "WDS_UAC_PROCEEDING";
    case theWipSt.WDS_UAC_ACCEPTED:      return "WDS_UAC_ACCEPTED";
    case theWipSt.WDS_UAC_ESTABLISHED:   return "WDS_UAC_ESTABLISHED";
    case theWipSt.WDS_UAC_DISCONNECTING: return "WDS_UAC_DISCONNECTING";
    case theWipSt.WDS_UAS_DISCONNECTED:  return "WDS_UAS_DISCONNECTED";
    }
    return "UNKNOWN";
  }
  logWarnWip(strFunc)
  {
    console.log("[WARNING] " + strFunc + " 처리할 수 없는 상태 입니다. [현재상태: " + this.getStateStr() + "(" + this.mnWds + ")]");
    return false;
  }
  changeState(iDlg, iNewSt)
  {
    console.log("[INFO] WIP Dialog 상태 전환: [" + this.getStateStr() + " => " + iNewSt.getStateStr() + "]");
    var nWdsOld = this.mnWds;
    iDlg.miWipStMc = iNewSt;
    switch(iNewSt.mnWds)
    {
    case theWipSt.WDS_UAC_ESTABLISHED:
      module.CbEstablishedCall(iDlg.mnIdx);
      break;
    case theWipSt.WDS_UA_TERMINATED:
      if(iDlg.miWebRTCPeer)
      {
        iDlg.miWebRTCPeer.dispose();
        iDlg.miWebRTCPeer = null;
      }
      if(iDlg.mtWipId)
        clearTimeout(iDlg.mtWipId);
      iDlg.mtWipId = setTimeout(function()
                                {
                                  iDlg.WipTimeout();
                                }, 1000);
      module.CbTerminatedCall(iDlg.mnIdx);
      break;
    case theWipSt.WDS_UA_NULL:
      if(nWdsOld != theWipSt.WDS_UA_NONE)
        iDlg.WipReleased();
      break;
    }
  }
  WsConnect(iDlg)             { return this.logWarnWip("WsConnect"); }
  WsClose(iDlg)               { return this.logWarnWip("WsClose"); }
  MakeCall(iDlg)              { return this.logWarnWip("MakeCall"); }
  Invite(iDlg, jMsg, nCmd)    { return this.logWarnWip("Invite"); }
  Proceed(iDlg, jMsg)         { return this.logWarnWip("Proceed"); }
  Accept(iDlg, jMsg)          { return this.logWarnWip("Accept"); }
  Cancel(iDlg, jMsg)          { return this.logWarnWip("Cancel"); }
  Reject(iDlg, jMsg)          { return this.logWarnWip("Reject"); }
  Connect(iDlg, jMsg)         { return this.logWarnWip("Connect"); }
  Candidate(iDlg, jMsg, nCmd) { return this.logWarnWip("Candidate"); }
  ByeSend(iDlg, jMsg)         { return this.logWarnWip("ByeSend"); }
  ByeRecv(iDlg, jMsg)         { return this.logWarnWip("ByeRecv"); }
  Disconnect(iDlg, jMsg)      { return this.logWarnWip("Disconnect"); }
  Timeout(iDlg)               { return this.logWarnWip("Timeout"); }
};

class MWipUastNone extends MWipStateMc
{
  constructor()
  {
    super(theWipSt.WDS_UA_NONE);
  }
  WsConnect(iDlg)
  {
    console.log("MWipUastNone::WsConnect");
    this.changeState(iDlg, theWipNull);
  }
};

class MWipUastNull extends MWipStateMc
{
  constructor()
  {
    super(theWipSt.WDS_UA_NULL);
  }
  MakeCall(iDlg)
  {
    console.log("MWipUastNull::MakeCall");
    if(!iDlg.SendInvite())
      return false;
    this.changeState(iDlg, theWipMake);
    return true;
  }
  WsClose(iDlg)
  {
    console.log("MWipUastNull::WsClose");
    this.changeState(iDlg, theWipNone);
    return true;
  }
};

class MWipUastTerminated extends MWipStateMc
{
  constructor()
  {
    super(theWipSt.WDS_UA_TERMINATED);
  }
  Timeout(iDlg)
  {
    console.log("MWipUastTerminated::Release");
    this.changeState(iDlg, theWipNull);
    return true;
  }
  WsClose(iDlg)
  {
    console.log("MWipUastTerminated::WsClose");
    this.changeState(iDlg, theWipNull);
    return iDlg.miWipStMc.WsClose(iDlg);
  }
};

/////////////////////////////////////////////////////////////////////////////////////////
// UAC State Machine Implement
class MWipUaCState extends MWipStateMc
{
  constructor(nWds)
  {
    super(nWds);
  }
  logWipSend(jMsg)
  {
    console.log("[INFO] >>>>> WIP UAC Message Send (length=" + jMsg.length + ") >>>>>\n" + jMsg);
  }
  logWipRecv(jMsg)
  {
    console.log("[INFO] >>>>> WIP UAC Message Recv (length=" + jMsg.length + ") >>>>>\n" + jMsg);
  }
  CandidateSend(iDlg, jMsg)
  {
    console.log("MWipUaCState::CandidateSend");
    return iDlg.SendMsg(jMsg);
  }
  CandidateRecv(iDlg, jMsg)
  {
    console.log("MWipUaCState::CandidateRecv");
    var bRet = false;
    if(this.mnWds == theWipSt.WDS_UAC_ESTABLISHED)
    {
      iDlg.miWebRTCPeer.addIceCandidate(jMsg.candidate, function(error)
                                                        {
                                                          if(error)
                                                            return console.error('Error adding candidate: ' + error);
                                                        });
      bRet = true;
    }
    else
      console.log("Not Ready Yet!!");
    return bRet;
  }
  WsClose(iDlg)
  {
    console.log("MWipUaCState::WsClose");
    this.changeState(iDlg, theWipNull);
    return iDlg.miWipStMc.WsClose(iDlg);
  }
};

class MWipUaCstMaking extends MWipUaCState
{
  constructor()
  {
    super(theWipSt.WDS_UAC_MAKING);
  }
  Invite(iDlg, jMsg, nCmd)
  {
    console.log("MWipUastNull::Invite");
    switch(nCmd)
    {
    case theWipCmd.WIP_SEMD_MSG:
      if(!iDlg.SendMsg(jMsg))
        return false;
      iDlg.mtWipId = setTimeout(function()
                                {
                                  iDlg.WipTimeout();
                                }, 1000);
      this.changeState(iDlg, theWipCall);
      break;
    case theWipCmd.WIP_RECV_MSG:
      console.log("[WARNING] UAS Invite 는 아직 지원하지 않습니다.");
      return false;
    }
    return true;
  }
  Cancel(iDlg, jMsg)
  {
    console.log("MWipUaCstCalling::Cancel");
    this.changeState(iDlg, theWipTerm);
    return true;
  }
};

class MWipUaCstCalling extends MWipUaCState
{
  constructor()
  {
    super(theWipSt.WDS_UAC_CALLING);
  }
  Proceed(iDlg, jMsg)
  {
    console.log("MWipUaCstCalling::Proceed");
    if(iDlg.mtWipId)
      clearTimeout(iDlg.mtWipId);
    this.changeState(iDlg, theWipProc);
    //iDlg.SendStoredMsg();
    return true;
  }
  Cancel(iDlg, jMsg)
  {
    console.log("MWipUaCstCalling::Cancel");
    iDlg.SendCancel();
    this.changeState(iDlg, theWipTerm);
    return true;
  }
  Reject(iDlg, jMsg)
  {
    console.log("MWipUaCstCalling::Reject");
    iDlg.RecvReject(jMsg.reason);
    this.changeState(iDlg, theWipTerm);
    return true;
  }
};

class MWipUaCstProceeding extends MWipUaCState
{
  constructor()
  {
    super(theWipSt.WDS_UAC_PROCEEDING);
  }
  Accept(iDlg, jMsg)
  {
    console.log("MWipUaCstProceeding::Accept");
    if(!iDlg.RecvAccept(jMsg))
    {
      console.log("MWipUaCstProceeding::Accept-1");
      return false;
    }
    console.log("MWipUaCstProceeding::Accept-2");
    this.changeState(iDlg, theWipAccp);
    //iDlg.SendStoredMsg();
    console.log("MWipUaCstProceeding::Accept-3");
    return iDlg.miWipStMc.Connect(iDlg);
  }
  Cancel(iDlg, jMsg)
  {
    console.log("MWipUaCstProceeding::Cancel");
    iDlg.SendCancel();
    this.changeState(iDlg, theWipTerm);
    return true;
  }
  Reject(iDlg, jMsg)
  {
    console.log("MWipUaCstProceeding::Reject");
    iDlg.RecvReject(jMsg.reason);
    this.changeState(iDlg, theWipTerm);
    return true;
  }
  /*
  Candidate(iDlg, jMsg, nCmd)
  {
    console.log("MWipUaCstProceeding::Candidate");
    var bRet = false;
    switch(nCmd)
    {
    case theWipCmd.WIP_SEMD_MSG:  bRet = this.CandidateSend(iDlg, jMsg); break;
    case theWipCmd.WIP_RECV_MSG:  bRet = this.CandidateRecv(iDlg, jMsg); break;
    }
    return bRet;
  }
  */
};

class MWipUaCstAccepted extends MWipUaCState
{
  constructor()
  {
    super(theWipSt.WDS_UAC_ACCEPTED);
  }
  Connect(iDlg, jMsg)
  {
    console.log("MWipUaCstAccepted::Connect");
    if(!iDlg.SendConnect())
      return false;
    iDlg.SendStoredMsg();
    this.changeState(iDlg, theWipEsta);
    return true;
  }
  Candidate(iDlg, jMsg, nCmd)
  {
    console.log("MWipUaCstAccepted::Candidate");
    var bRet = false;
    switch(nCmd)
    {
    case theWipCmd.WIP_SEMD_MSG:  bRet = this.CandidateSend(iDlg, jMsg); break;
    case theWipCmd.WIP_RECV_MSG:  bRet = this.CandidateRecv(iDlg, jMsg); break;
    }
    return bRet;
  }
};

class MWipUaCstEstablished extends MWipUaCState
{
  constructor()
  {
    super(theWipSt.WDS_UAC_ESTABLISHED);
  }
  Candidate(iDlg, jMsg, nCmd)
  {
    console.log("MWipUaCstEstablished::Candidate");
    var bRet = false;
    switch(nCmd)
    {
    case theWipCmd.WIP_SEMD_MSG:  bRet = this.CandidateSend(iDlg, jMsg); break;
    case theWipCmd.WIP_RECV_MSG:  bRet = this.CandidateRecv(iDlg, jMsg); break;
    }
    return bRet;
  }
  ByeSend(iDlg, jMsg)
  {
    console.log("MWipUaCstEstablished::ByeSend");
    if(iDlg.mtWipId)
      clearTimeout(iDlg.mtWipId);
    iDlg.SendBye(jMsg);
    iDlg.mtWipId = setTimeout(function()
                              {
                                iDlg.WipTimeout();
                              }, 1000);
    this.changeState(iDlg, theWipDisI);
    return true;
  }
  ByeRecv(iDlg, jMsg)
  {
    console.log("MWipUaCstEstablished::ByeRecv");
    iDlg.RecvBye();
    this.changeState(iDlg, theWipDisD);
    return iDlg.miWipStMc.Disconnect(iDlg);
  }
};

class MWipUaCstDisconnecting extends MWipUaCState
{
  constructor()
  {
    super(theWipSt.WDS_UAC_DISCONNECTING);
  }
  Disconnect(iDlg, jMsg)
  {
    console.log("MWipUaCstDisconnecting::Disconnect");
    this.changeState(iDlg, theWipTerm);
    return true;
  }
  Timeout(iDlg)
  {
    console.log("MWipUaCstDisconnecting::Timeout");
    this.changeState(iDlg, theWipTerm);
    return true;
  }
};

/////////////////////////////////////////////////////////////////////////////////////////
// UAS State Machine Implement
class MWipUaSState extends MWipStateMc
{
  constructor(nWds)
  {
    super(nWds);
  }
  logWipSend(jMsg)
  {
    console.log("[INFO] >>>>> WIP UAS Message Send (length=" + jMsg.length + ") >>>>>\n" + jMsg);
  }
  logWipRecv(jMsg)
  {
    console.log("[INFO] >>>>> WIP UAS Message Recv (length=" + jMsg.length + ") >>>>>\n" + jMsg);
  }
  WsClose(iDlg)
  {
    console.log("MWipUaSState::WsClose");
    this.changeState(iDlg, theWipNull);
    return iDlg.miWipStMc.WsClose(iDlg);
  }
};

class MWipUaSstDisconnected extends MWipUaSState
{
  constructor()
  {
    super(theWipSt.WDS_UAS_DISCONNECTED);
  }
  Disconnect(iDlg, jMsg)
  {
    console.log("MWipUaSstDisconnected::Disconnect");
    iDlg.SendDisconnect();
    this.changeState(iDlg, theWipTerm);
    return true;
  }
};

/////////////////////////////////////////////////////////////////////////////////////////
var theWipNone = new MWipUastNone();
var theWipNull = new MWipUastNull();
var theWipMake = new MWipUaCstMaking();
var theWipCall = new MWipUaCstCalling();
var theWipProc = new MWipUaCstProceeding();
var theWipAccp = new MWipUaCstAccepted();
var theWipEsta = new MWipUaCstEstablished();
var theWipDisI = new MWipUaCstDisconnecting();
var theWipDisD = new MWipUaSstDisconnected();
var theWipTerm = new MWipUastTerminated();

/////////////////////////////////////////////////////////////////////////////////////////
// WIP Dialog Implement
class MWipDialog
{
  constructor(nIdx, strAni, strDnis, strWsUrl, oAudioDvc)
  {
    this.mnIdx = nIdx;
    this.mstrAni = strAni;
    this.mstrDnis = strDnis;
    this.mstrWsUrl = strWsUrl;
    this.miWsStMc = theWsNone;
    this.miWipStMc = theWipNone;
    this.miWs = null;
    this.mnTokenId = 0;
    this.mnKaInterval = 0;
    this.mtKa = 0;
    this.mtWsId = 0;
    this.mnWsToCnt = 0;
    this.mnNextToId = 0;
    this.miWebRTCPeer = null;
    this.mtWipId = 0;
    this.mstrCallId = gGetUuid();
    this.mnRetryCnt = 0;
    this.mqSendMsg = new Queue();
    theAudioDvc = oAudioDvc;
  }

  onOpen(oEvt)
  {
    console.log("MWipDialog::onOpen");
    this.miWsStMc.InitSession(this);
  }
  onClose(oEvt)
  {
    console.log("MWipDialog::onClose");
    if(!this.miWsStMc.ReconnectSession(this))
      this.WsClose();
  }
  onMessage(oEvt)
  {
    console.log("MWipDialog::onMessage "+oEvt.data);
    this.RecvMsg(oEvt.data);
  }
  onConnecting(oEvt)
  {
    console.log("MWipDialog::onConnecting");
  }
  onError(oEvt)
  {
    console.log("MWipDialog::onError");
  }

  onCreateWebRTCPeer(oErr)
  {
    if(oErr) return console.error(oErr);
    this.miWebRTCPeer.generateOffer(module.CbOfferCall, this.mnIdx);
  }

  onOfferCall(strError, strSdp)
  {
    if(strError)
      return console.error("[ERROR] Generating the offer");
    console.log('Invoking SDP offer callback function');
    console.log(strSdp);
    var jMsg =
    {
      type:     theWipMsg.INVITE,
      version:  theWipVersion,
      token_id: this.mnTokenId,
      call_id:  this.mstrCallId,
      from:     this.mstrAni,
      to:       this.mstrDnis,
      sdp:      strSdp
    };
    this.miWsStMc.Processing(this, theWipCmd.WIP_SEMD_MSG, jMsg);
  }

  onIceCandidate(jCandidate)
  {
    console.log("Local candidate" + JSON.stringify(jCandidate));
    var jMsg =
    {
      type:       theWipMsg.CANDIDATE,
      version:    theWipVersion,
      token_id:   this.mnTokenId,
      call_id:    this.mstrCallId,
      candidate:  jCandidate
    };
    if(!this.miWsStMc.Processing(this, theWipCmd.WIP_SEMD_MSG, jMsg))
      this.mqSendMsg.Push(jMsg);
  }

  SendStoredMsg()
  {
    while(this.mqSendMsg.Count() > 0)
    {
      var jPkt = this.mqSendMsg.Pop();
      if(jPkt)
        this.SendMsg(jPkt);
    }
  }

  SendMsg(jMsg)
  {
    var jrMsg = JSON.stringify(jMsg);
    console.log("[INFO] >>>>> WIP Message Send (length=" + jrMsg.length + ") >>>>>\n" + jrMsg);
    this.miWs.send(jrMsg);
    return true;
  }

  RecvMsg(jrMsg)
  {
    console.log("[INFO] <<<<< WIP Message Recv (length=" + jrMsg.length + ") >>>>>\n" + jrMsg);
    var jMsg = JSON.parse(jrMsg);
    var bRet = false;
    switch(jMsg.type)
    {
    case theWipMsg.INIT_SESSION_REPLY:
      bRet = this.miWsStMc.InitSessionReply(this, jMsg);
      if(bRet)
        module.CbInitializedWebSocket(this.mnIdx, this.mnRetryCnt);
      break;
    case theWipMsg.PONG:
      bRet = this.miWsStMc.RecvPong(this);
      break;
    case theWipMsg.PROCEED:
    case theWipMsg.ACCEPT:
    case theWipMsg.CANDIDATE:
    case theWipMsg.BYE:
    case theWipMsg.DISCONNECT:
    case theWipMsg.REJECT:
      bRet = this.miWsStMc.Processing(this, theWipCmd.WIP_RECV_MSG, jMsg);
      break;
      /*
      {
        var disconnectcall = new Object();
        disconnectcall.type = "Disconnect";
        disconnectcall.version = version;
        disconnectcall.token_id = token_id;
        disconnectcall.call_id = call_id;
        sendMessage(JSON.stringify(disconnectcall));
        if(ka_timer != null)
          clearInterval(ka_timer);
        ws3pcc.close();
      }
      */
    case theWipMsg.INIT_SESSION:
    case theWipMsg.PING:
    case theWipMsg.INVITE:
    case theWipMsg.CONNECT:
    case theWipMsg.CANCEL:
      console.log("[WARN] Not Support Message Type [" + jMsg.type + "]");
      break;

    }
    if(!bRet)
    {
      console.log("[WARN] Receive Processing Failed!!");
      this.WsClose();
    }
    return bRet;
  }

  WsTimeout()
  {
    this.mtWsId = 0;
    this.miWsStMc.WsTimeout(this);
  }

  WsRelease()
  {
    if(this.mtKa)
    {
      clearInterval(this.mtKa);
      this.mtKa = 0;
    }
    if(this.mtWsId)
    {
      clearTimeout(this.mtWsId);
      this.mtWsId = 0;
    }
    if(this.miWs != null)
    {
      this.miWs.close();
      this.miWs = null;
    }
    if(this.mqSendMsg)
      this.mqSendMsg = null;
    module.CbReleasedWebSocket(this.mnIdx);
  }

  WipTimeout()
  {
    this.mtWipId = 0;
    this.miWsStMc.Processing(this, theWipCmd.WIP_TIMEOUT);
  }

  WipReleased()
  {
    if(this.mtWipId)
    {
      clearTimeout(this.mtWipId);
      this.mtWipId = 0;
    }
    if(this.mqSendMsg.Count() > 0)
      this.mqSendMsg.Clear();
    if(this.miWebRTCPeer)
    {
      this.miWebRTCPeer.dispose();
      this.miWebRTCPeer = null;
    }
    module.CbReleasedCall(this.mnIdx);
  }

  SendPing()
  {
    if(!this.miWsStMc.SendPing(this))
      this.miWsStMc.ReconnectSession(this)
    return true;
  }

  RecvPong()
  {
    if(this.mtWsId)
      clearTimeout(this.mtWsId);
    this.mtWsId = 0;
    this.mnWsToCnt = 0;
    return true;
  }

  SendInvite()
  {
    console.log("MWipDialog::SendInvite");
    var jConstraints =
    {
      audio: true,
      video: false
    };
    var jConfig =
    {
      iceServers: [{"urls":"turn:3.36.177.3:3478","username":"helpnow","credential":"opsbot12"}]
      //iceServers: [{"urls":"stun:stun1.example.net"},{"urls":"stun:stun2.example.net"}]
    };
    var jOptions =
    {
      onicecandidate: module.CbIceCandidate,
      mediaConstraints: jConstraints,
      configuration: jConfig
    };
    this.miWebRTCPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(jOptions, module.CbCreateWebRTCPeer, this.mnIdx);
    if(!this.miWebRTCPeer)
    {
      console.log("Create PeerConnection Faile!!");
      return false;
    }
    return true;
  }
  RecvInvite()
  {
    console.log("MWipDialog::RecvInvite");
    return true;
  }
  SendProceed()
  {
    console.log("MWipDialog::SendProceed");
    return true;
  }
  RecvProceed()
  {
    console.log("MWipDialog::RecvProceed");
    return true;
  }
  SendAccept()
  {
    console.log("MWipDialog::SendAccept");
    return true;
  }
  RecvAccept(jMsg)
  {
    console.log("MWipDialog::RecvAccept -0");
    var self = this;
    this.miWebRTCPeer.processAnswer(jMsg.sdp,
                                    function(error)
                                    {
                                      console.log("MWipDialog::RecvAccept -1");
                                      if(error) return console.error(error);
                                      console.log("MWipDialog::RecvAccept -2");
                                      theAudioDvc.srcObject = self.miWebRTCPeer.getRemoteStream(0);
                                      console.log("MWipDialog::RecvAccept -3");
                                    });
    return true;
  }
  SendConnect()
  {
    console.log("MWipDialog::SendConnect");
    var jMsg =
    {
      type:     theWipMsg.CONNECT,
      version:  theWipVersion,
      token_id: this.mnTokenId,
      call_id:  this.mstrCallId
    };
    return this.SendMsg(jMsg);
  }
  RecvConnect()
  {
    console.log("MWipDialog::RecvConnect");
    return true;
  }
  SendBye(jMsg)
  {
    console.log("MWipDialog::SendBye");
    /*
    var jMsg =
    {
      type:     theWipMsg.BYE,
      version:  theWipVersion,
      token_id: this.mnTokenId,
      call_id:  this.mstrCallId
    };
    */
    return this.SendMsg(jMsg);
  }
  RecvBye()
  {
    console.log("MWipDialog::RecvBye");
    return true;
  }
  SendDisconnect()
  {
    console.log("MWipDialog::SendDisconnect");
    var jMsg =
    {
      type:     theWipMsg.DISCONNECT,
      version:  theWipVersion,
      token_id: this.mnTokenId,
      call_id:  this.mstrCallId
    };
    return this.SendMsg(jMsg);
  }
  RecvDisconnect()
  {
    console.log("MWipDialog::RecvDisconnect");
    return true;
  }
  SendReject()
  {
    console.log("MWipDialog::SendReject");
    return true;
  }
  RecvReject(jReason)
  {
    console.log("MWipDialog::RecvReject");
    module.CbRejectedCall(this.mnIdx, jReason);
    return true;
  }
  SendCancel()
  {
    console.log("MWipDialog::SendCancel");
    var jMsg =
    {
      type:     theWipMsg.CANCEL,
      version:  theWipVersion,
      token_id: this.mnTokenId,
      call_id:  this.mstrCallId
    };
    return this.SendMsg(jMsg);
  }
  RecvCancel()
  {
    console.log("MWipDialog::RecvCancel");
    return true;
  }

  WsConnect()
  {
    console.log("MWipDialog::WsConnect");
    if(!this.miWsStMc.ConnectSession(this))
      return false;
    this.miWs.onopen       = (oEvt) => { this.onOpen(oEvt); }
    this.miWs.onclose      = (oEvt) => { this.onClose(oEvt); }
    this.miWs.onmessage    = (oEvt) => { this.onMessage(oEvt); }
    this.miWs.onconnecting = (oEvt) => { this.onConnecting(oEvt); }
    this.miWs.onerror      = (oEvt) => { this.onError(oEvt); }
    return true;
  }

  WsReconnect()
  {
    console.log("MWipDialog::WsReconnect");
    if(!this.miWsStMc.ReconnectSession(this))
      return false;
    this.miWs.onopen       = (oEvt) => { this.onOpen(oEvt); }
    this.miWs.onclose      = (oEvt) => { this.onClose(oEvt); }
    this.miWs.onmessage    = (oEvt) => { this.onMessage(oEvt); }
    this.miWs.onconnecting = (oEvt) => { this.onConnecting(oEvt); }
    this.miWs.onerror      = (oEvt) => { this.onError(oEvt); }
    return true;
  }

  WsClose()
  {
    console.log("MWipDialog::WsClose");
    this.miWsStMc.CloseSession(this);
  }

  WipMakeCall()
  {
    console.log("MWipDialog::WipMakeCall");
    return this.miWsStMc.Processing(this, theWipCmd.WIP_MAKE_CALL);
  }

  WipClearCall()
  {
    console.log("MWipDialog::WipClearCall");
    var jMsg =
    {
      type:       theWipMsg.BYE,
      version:    theWipVersion,
      token_id:   this.mnTokenId,
      call_id:    this.mstrCallId
    };
    return this.miWsStMc.Processing(this, theWipCmd.WIP_SEMD_MSG, jMsg);
  }
};

/*
 * Multi-call 기능을 필요로 할경우 아래 함수를 사용자가 직접 재정의 하여 사용한다.
 * 재정의 방법은 index.html 파일을 참고한다.
*/
var iWipDlg = null;
module.MakeWipDlg = function(strAni, strDnis, strWsUrl, oAudio)
{
  iWipDlg = new MWipDialog(0, strAni, strDnis, strWsUrl, oAudio);
  console.log("Make WIP Dialog!!");
  return iWipDlg;
}
module.RemoveWipDlg = function(id)
{
  iWipDlg = null;
  console.log("Remove WIP Dialog!!");
}
module.GetWipDlg = function(id)
{
  return iWipDlg;
}
module.CbUnforeseenWebSocketDisconnect = function(id, retry)
{
  console.log("module.CbUnforeseenWebSocketDisconnect : " + id + ", retry=" + retry);
  if(retry < 5)
    return true; // 재연결 시도
  return false; // 세션 종료
}
module.CbInitializedWebSocket = function(id, retry)
{
  console.log("module.CbInitializedWebSocket : " + id + ", retry=" + retry);
  if(retry == 0)
  {
    var iWipDlg = module.GetWipDlg(id);
    if(!iWipDlg.WipMakeCall())  // 웹소켓 연결 후 바로 발신
    {
      iWipDlg.WsClose();
      return false;
    }
  }
  return true;
}
module.CbReleasedWebSocket = function(id)
{
  console.log("module.CbReleasedWebSocket : " + id);
  module.RemoveWipDlg(id);
}
module.CbEstablishedCall = function(id)
{
  console.log("module.CbEstablishedCall : " + id);
}
module.CbRejectedCall = function(id, jReason)
{
  console.log("module.CbRejectedCall : " + id + " [" + jReason.code + ": " + jReason.text + "]");
}
module.CbTerminatedCall = function(id)
{
  console.log("module.CbTerminatedCall : " + id);
}
module.CbReleasedCall = function(id)
{
  console.log("module.CbReleasedCall : " + id);
  var iWipDlg = module.GetWipDlg(id);
  iWipDlg.WsClose(); // 통화가 완전히 종료되면 웹소켓 close
}
module.CbCreateWebRTCPeer = function(id, error)
{
  console.log("module.CbCreateWebRTCPeer : " + id);
  var iWipDlg = module.GetWipDlg(id);
  return iWipDlg.onCreateWebRTCPeer(error);
}
module.CbOfferCall = function(id, strError, strSdp)
{
  console.log("module.CbOfferCall : " + id);
  var iWipDlg = module.GetWipDlg(id);
  return iWipDlg.onOfferCall(strError, strSdp);
}
module.CbIceCandidate = function(id, jCandidate)
{
  console.log("module.CbIceCandidate : " + id);
  var iWipDlg = module.GetWipDlg(id);
  return iWipDlg.onIceCandidate(jCandidate);
}

module.MWipDialog = MWipDialog;

})((this.webip = {}), this);
