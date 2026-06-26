async function open_voice_room(params) {
  return {
    success: true,
    data: {
      message: '语音聊天室已准备好，请点击「管理页面」按钮进入。'
    }
  };
}
 
exports.open_voice_room = open_voice_room;
 