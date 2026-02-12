const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      authMode: 'login',
      isAuthenticated: false,
      authToken: localStorage.getItem('authToken') || '',
      currentUser: localStorage.getItem('currentUser') || '',
      socket: null,
      roomRefreshTimer: null,
      isMobileView: false,
      isSidebarVisible: true,
      createdRooms: [],
      joinedRooms: [],
      currentRoomId: null,
      currentRoomName: '',
      currentRoomDesc: '',
      currentRoomStatus: 'joined',
      roomMembers: [],
      roomMemberCount: 0,
      roomOnlineCount: 0,
      roomOwnerId: null,
      roomAllOnlineReady: false,
      roomOnlineReadyCount: 0,
      isGameRedirecting: false,
      chatMessages: [],
      messageInput: '',
      loginForm: {
        username: '',
        password: ''
      },
      registerForm: {
        username: '',
        password: '',
        confirmPassword: ''
      },
      createRoomForm: {
        name: '',
        description: ''
      },
      joinRoomForm: {
        name: ''
      },
      errors: {
        login: '',
        register: '',
        createRoom: '',
        joinRoom: ''
      }
    };
  },
  computed: {
    currentRoomStatusText() {
      return this.currentRoomStatus === 'created' ? '我创建' : '已加入';
    },
    currentUserReady() {
      const selfMember = this.roomMembers.find((member) => member.username === this.currentUser);
      return !!(selfMember && selfMember.ready);
    },
    isCurrentRoomOwner() {
      if (Number.isInteger(this.roomOwnerId) && this.roomOwnerId > 0) {
        const selfMember = this.roomMembers.find((member) => member.username === this.currentUser);
        if (selfMember) {
          return Number(selfMember.user_id) === Number(this.roomOwnerId);
        }
      }
      return this.currentRoomStatus === 'created';
    },
    canStartGame() {
      return this.isCurrentRoomOwner && this.roomOnlineCount > 0 && this.roomAllOnlineReady;
    },
    readyActionText() {
      return this.currentUserReady ? '取消准备' : '准备';
    }
  },
  methods: {
    switchAuthMode(mode) {
      this.authMode = mode;
      this.errors.login = '';
      this.errors.register = '';
    },
    async apiRequest(path, options = {}) {
      const response = await fetch(path, options);
      let data = {};
      try {
        data = await response.json();
      } catch (_) {
        data = {};
      }

      if (!response.ok) {
        throw new Error(data.message || `请求失败 (${response.status})`);
      }

      return data;
    },
    resolveSocketEndpoint() {
      if (typeof window !== 'undefined' && typeof window.__MOSECAT_WS_URL__ === 'string' && window.__MOSECAT_WS_URL__) {
        return window.__MOSECAT_WS_URL__;
      }

      const { protocol, hostname, port } = window.location;
      if (port === '19924') {
        return `${protocol}//${hostname}:19925`;
      }

      return '';
    },
    connectSocket() {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }

      const endpoint = this.resolveSocketEndpoint();
      const options = {
        transports: ['websocket', 'polling'],
        query: {
          token: this.authToken,
          username: this.currentUser
        }
      };

      this.socket = endpoint ? io(endpoint, options) : io(options);

      this.socket.on('connect', () => {
        if (this.currentRoomId) {
          this.socket.emit('room:join', { room_id: this.currentRoomId });
          this.loadRoomMembers(this.currentRoomId);
          this.loadRoomHistory(this.currentRoomId);
        }
      });

      this.socket.on('room:message', (message) => {
        if (Number(message.room_id) !== Number(this.currentRoomId)) {
          return;
        }
        this.chatMessages.push({ type: 'message', ...message });
        this.scrollChatToBottom();
      });

      this.socket.on('room:event', (event) => {
        if (Number(event.room_id) !== Number(this.currentRoomId)) {
          return;
        }
        this.chatMessages.push(event);
        this.scrollChatToBottom();
        this.loadRoomMembers(this.currentRoomId);
      });

      this.socket.on('room:lobby:update', (snapshot) => {
        if (Number(snapshot.room_id) !== Number(this.currentRoomId)) {
          return;
        }
        this.applyRoomLobbySnapshot(snapshot);
      });

      this.socket.on('room:game:started', (payload) => {
        if (Number(payload.room_id) !== Number(this.currentRoomId)) {
          return;
        }
        this.goToGamePage(payload);
      });

      this.socket.on('error', (error) => {
        console.error('Socket error:', error);
      });

      this.socket.on('connect_error', (error) => {
        console.error('Socket connect error:', error);
      });
    },
    async ensureSocketConnected() {
      if (this.socket && this.socket.connected) {
        return;
      }

      if (!this.socket) {
        throw new Error('WebSocket 未初始化');
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('WebSocket 连接超时'));
        }, 8000);

        this.socket.once('connect', () => {
          clearTimeout(timer);
          resolve();
        });

        this.socket.once('connect_error', (error) => {
          clearTimeout(timer);
          reject(error || new Error('WebSocket 连接失败'));
        });
      });
    },
    emitWithAck(eventName, payload, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        if (!this.socket || !this.socket.connected) {
          reject(new Error('WebSocket 未连接'));
          return;
        }

        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          reject(new Error(`${eventName} 请求超时`));
        }, timeoutMs);

        this.socket.emit(eventName, payload, (response) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(response);
        });
      });
    },
    applyRoomLobbySnapshot(snapshot) {
      if (!snapshot) {
        return;
      }

      this.roomMemberCount = Number(snapshot.member_count || 0);
      this.roomOnlineCount = Number(snapshot.online_count || 0);
      this.roomOwnerId = Number(snapshot.owner_id || 0) || null;
      this.roomAllOnlineReady = !!snapshot.all_online_ready;
      this.roomOnlineReadyCount = Number(snapshot.online_ready_count || 0);
      this.roomMembers = (snapshot.members || []).map((member) => ({
        ...member,
        user_id: Number(member.user_id),
        online: !!member.online,
        ready: !!member.ready
      }));
    },
    buildGamePageUrl(rawUrl = '') {
      const fallback = `/game/?roomId=${this.currentRoomId}`;
      const target = new URL(rawUrl || fallback, window.location.origin);
      if (!target.searchParams.get('roomId') && this.currentRoomId) {
        target.searchParams.set('roomId', String(this.currentRoomId));
      }
      if (this.currentRoomName && !target.searchParams.get('roomName')) {
        target.searchParams.set('roomName', this.currentRoomName);
      }
      if (this.currentUser && !target.searchParams.get('nickname')) {
        target.searchParams.set('nickname', this.currentUser);
      }
      if (!target.searchParams.get('autostart')) {
        target.searchParams.set('autostart', '1');
      }
      return target.toString();
    },
    goToGamePage(payload = {}) {
      if (this.isGameRedirecting) {
        return;
      }
      this.isGameRedirecting = true;
      window.location.href = this.buildGamePageUrl(payload.game_url);
    },
    async toggleReady() {
      if (!this.currentRoomId) {
        alert('请先选择一个房间');
        return;
      }

      try {
        await this.ensureSocketConnected();
        const response = await this.emitWithAck('room:ready:set', {
          room_id: this.currentRoomId,
          ready: !this.currentUserReady
        });
        if (!response || !response.ok) {
          throw new Error((response && response.message) || '准备状态更新失败');
        }
      } catch (error) {
        alert(error.message || '准备状态更新失败');
      }
    },
    async startGame() {
      if (!this.currentRoomId) {
        alert('请先选择一个房间');
        return;
      }
      if (!this.isCurrentRoomOwner) {
        alert('只有房主可以开始游戏');
        return;
      }

      this.isGameRedirecting = false;
      try {
        await this.ensureSocketConnected();
        const response = await this.emitWithAck('room:game:start', {
          room_id: this.currentRoomId
        });
        if (!response || !response.ok) {
          throw new Error((response && response.message) || '开始游戏失败');
        }
        this.goToGamePage(response);
      } catch (error) {
        this.isGameRedirecting = false;
        alert(error.message || '开始游戏失败');
      }
    },
    startRoomAutoRefresh() {
      this.stopRoomAutoRefresh();
      if (!this.currentRoomId) {
        return;
      }

      this.roomRefreshTimer = setInterval(() => {
        if (!this.currentRoomId) return;
        this.loadRoomHistory(this.currentRoomId);
        this.loadRoomMembers(this.currentRoomId);
      }, 3000);
    },
    stopRoomAutoRefresh() {
      if (!this.roomRefreshTimer) {
        return;
      }
      clearInterval(this.roomRefreshTimer);
      this.roomRefreshTimer = null;
    },
    updateViewportState() {
      this.isMobileView = window.matchMedia('(max-width: 900px)').matches;
    },
    toggleSidebar() {
      this.isSidebarVisible = !this.isSidebarVisible;
      if (this.isMobileView && this.isSidebarVisible) {
        nextTick(() => {
          const panel = this.$refs.sidebarPanel;
          if (panel && typeof panel.scrollTo === 'function') {
            panel.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });
      }
    },
    async onAuthSuccess(token, username) {
      this.authToken = token;
      this.currentUser = username;
      this.isAuthenticated = true;
      localStorage.setItem('authToken', token);
      localStorage.setItem('currentUser', username);
      this.connectSocket();
      await this.loadRooms();
    },
    async register() {
      this.errors.register = '';
      const username = this.registerForm.username.trim();
      const password = this.registerForm.password;
      const confirmPassword = this.registerForm.confirmPassword;

      if (!username || !password || !confirmPassword) {
        this.errors.register = '请填写所有字段';
        return;
      }
      if (password.length < 6) {
        this.errors.register = '密码长度至少6个字符';
        return;
      }
      if (password !== confirmPassword) {
        this.errors.register = '两次密码不一致';
        return;
      }

      try {
        const data = await this.apiRequest('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        await this.onAuthSuccess(data.token, data.username);
      } catch (error) {
        this.errors.register = error.message;
      }
    },
    async login() {
      this.errors.login = '';
      const username = this.loginForm.username.trim();
      const password = this.loginForm.password;
      if (!username || !password) {
        this.errors.login = '请输入用户名和密码';
        return;
      }

      try {
        const data = await this.apiRequest('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        await this.onAuthSuccess(data.token, data.username);
      } catch (error) {
        this.errors.login = error.message;
      }
    },
    logout() {
      if (!confirm('确定要退出吗？')) return;
      this.stopRoomAutoRefresh();
      localStorage.removeItem('authToken');
      localStorage.removeItem('currentUser');
      sessionStorage.removeItem('resumeRoomId');
      this.authToken = '';
      this.currentUser = '';
      this.isAuthenticated = false;
      this.authMode = 'login';
      this.currentRoomId = null;
      this.currentRoomName = '';
      this.currentRoomDesc = '';
      this.currentRoomStatus = 'joined';
      this.chatMessages = [];
      this.roomMembers = [];
      this.roomMemberCount = 0;
      this.roomOnlineCount = 0;
      this.roomOwnerId = null;
      this.roomAllOnlineReady = false;
      this.roomOnlineReadyCount = 0;
      this.isGameRedirecting = false;
      this.createdRooms = [];
      this.joinedRooms = [];
      this.isSidebarVisible = true;
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
    },
    async createRoom() {
      this.errors.createRoom = '';
      const name = this.createRoomForm.name.trim();
      const description = this.createRoomForm.description.trim();
      if (!name) {
        this.errors.createRoom = '请输入房间名称';
        return;
      }

      try {
        await this.apiRequest('/api/rooms/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.authToken}`
          },
          body: JSON.stringify({ name, description })
        });
        this.createRoomForm.name = '';
        this.createRoomForm.description = '';
        await this.loadRooms();
      } catch (error) {
        this.errors.createRoom = error.message;
      }
    },
    async joinRoom() {
      this.errors.joinRoom = '';
      const name = this.joinRoomForm.name.trim();
      if (!name) {
        this.errors.joinRoom = '请输入房间名称';
        return;
      }

      try {
        await this.apiRequest('/api/rooms/join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.authToken}`
          },
          body: JSON.stringify({ name })
        });
        this.joinRoomForm.name = '';
        await this.loadRooms();
      } catch (error) {
        this.errors.joinRoom = error.message;
      }
    },
    normalizeRoom(rawRoom) {
      return {
        ...rawRoom,
        id: Number(rawRoom.id),
        member_count: Number(rawRoom.member_count || 0)
      };
    },
    async loadRooms() {
      if (!this.isAuthenticated) return;
      try {
        const data = await this.apiRequest('/api/rooms/overview', {
          headers: { Authorization: `Bearer ${this.authToken}` }
        });
        this.createdRooms = (data.createdRooms || []).map(this.normalizeRoom);
        this.joinedRooms = (data.joinedRooms || []).map(this.normalizeRoom);
        this.syncCurrentRoomByRoomList();
        await this.tryResumeRoomFromStorage();
      } catch (error) {
        console.error('加载房间失败:', error);
      }
    },
    async tryResumeRoomFromStorage() {
      if (this.currentRoomId) {
        return;
      }
      const queryRoomId = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('resumeRoomId')
        : '';
      const rawRoomId = sessionStorage.getItem('resumeRoomId') || queryRoomId;
      if (!rawRoomId) {
        return;
      }

      const roomId = Number.parseInt(rawRoomId, 10);
      if (!Number.isInteger(roomId) || roomId <= 0) {
        sessionStorage.removeItem('resumeRoomId');
        return;
      }

      if (queryRoomId && typeof window !== 'undefined') {
        const cleanUrl = `${window.location.origin}${window.location.pathname}`;
        window.history.replaceState(null, '', cleanUrl);
      }

      const createdRoom = this.createdRooms.find((room) => room.id === roomId);
      if (createdRoom) {
        sessionStorage.removeItem('resumeRoomId');
        await this.selectRoom(createdRoom, 'created');
        return;
      }

      const joinedRoom = this.joinedRooms.find((room) => room.id === roomId);
      if (joinedRoom) {
        sessionStorage.removeItem('resumeRoomId');
        await this.selectRoom(joinedRoom, 'joined');
      }
    },
    syncCurrentRoomByRoomList() {
      if (!this.currentRoomId) return;
      const createdRoom = this.createdRooms.find((room) => room.id === this.currentRoomId);
      if (createdRoom) {
        this.currentRoomStatus = 'created';
        this.currentRoomName = createdRoom.name;
        this.currentRoomDesc = createdRoom.description || '';
        return;
      }

      const joinedRoom = this.joinedRooms.find((room) => room.id === this.currentRoomId);
      if (joinedRoom) {
        this.currentRoomStatus = 'joined';
        this.currentRoomName = joinedRoom.name;
        this.currentRoomDesc = joinedRoom.description || '';
        return;
      }

      this.currentRoomId = null;
      this.chatMessages = [];
      this.roomMembers = [];
      this.roomMemberCount = 0;
      this.roomOnlineCount = 0;
      this.roomOwnerId = null;
      this.roomAllOnlineReady = false;
      this.roomOnlineReadyCount = 0;
      this.isGameRedirecting = false;
      this.stopRoomAutoRefresh();
      this.isSidebarVisible = true;
    },
    async selectRoom(room, status) {
      const roomId = Number(room.id);
      if (!roomId || roomId <= 0) return;

      try {
        await this.ensureSocketConnected();
      } catch (error) {
        alert(error.message || 'WebSocket 未连接');
        return;
      }

      if (this.currentRoomId && this.currentRoomId !== roomId) {
        this.socket.emit('room:leave', { room_id: this.currentRoomId });
      }

      this.currentRoomId = roomId;
      this.currentRoomName = room.name;
      this.currentRoomDesc = room.description || '';
      this.currentRoomStatus = status;
      this.chatMessages = [];
      this.messageInput = '';
      this.roomMembers = [];
      this.roomMemberCount = 0;
      this.roomOnlineCount = 0;
      this.roomOwnerId = null;
      this.roomAllOnlineReady = false;
      this.roomOnlineReadyCount = 0;
      this.isGameRedirecting = false;

      this.socket.emit('room:join', { room_id: roomId });
      await Promise.all([this.loadRoomMembers(roomId), this.loadRoomHistory(roomId)]);
      this.startRoomAutoRefresh();
      if (this.isMobileView) {
        this.isSidebarVisible = false;
      }
    },
    updateRoomMemberCount(roomId, memberCount) {
      const update = (rooms) => {
        const target = rooms.find((room) => room.id === roomId);
        if (target) {
          target.member_count = memberCount;
        }
      };
      update(this.createdRooms);
      update(this.joinedRooms);
    },
    async loadRoomMembers(roomId) {
      if (!roomId) return;
      try {
        await this.ensureSocketConnected();
        const response = await this.emitWithAck('room:members:get', { room_id: roomId });
        if (!response || !response.ok) {
          return;
        }
        if (Number(response.room_id) !== Number(this.currentRoomId)) {
          return;
        }
        this.applyRoomLobbySnapshot(response);
        this.updateRoomMemberCount(roomId, this.roomMemberCount);
      } catch (error) {
        console.error('加载成员失败:', error);
      }
    },
    async loadRoomHistory(roomId) {
      if (!roomId) return;
      try {
        const data = await this.apiRequest(`/api/rooms/${roomId}/history`, {
          headers: { Authorization: `Bearer ${this.authToken}` }
        });
        this.chatMessages = data.history || [];
        this.scrollChatToBottom();
      } catch (error) {
        console.error('加载历史记录失败:', error);
      }
    },
    async leaveRoom(roomId) {
      if (!confirm('确定要退出这个房间吗？')) return;
      try {
        await this.apiRequest(`/api/rooms/${roomId}/leave`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.authToken}` }
        });

        if (this.socket && this.socket.connected) {
          this.socket.emit('room:leave', { room_id: roomId });
        }

        if (this.currentRoomId === roomId) {
          this.currentRoomId = null;
          this.currentRoomName = '';
          this.currentRoomDesc = '';
          this.chatMessages = [];
          this.roomMembers = [];
          this.roomMemberCount = 0;
          this.roomOnlineCount = 0;
          this.roomOwnerId = null;
          this.roomAllOnlineReady = false;
          this.roomOnlineReadyCount = 0;
          this.isGameRedirecting = false;
          this.stopRoomAutoRefresh();
          this.isSidebarVisible = true;
        }

        await this.loadRooms();
      } catch (error) {
        alert(error.message || '退出房间失败');
      }
    },
    async sendMessage() {
      if (!this.currentRoomId) {
        alert('请先选择一个房间');
        return;
      }

      const content = this.messageInput.trim();
      if (!content) return;

      try {
        await this.apiRequest('/api/messages/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.authToken}`
          },
          body: JSON.stringify({
            room_id: this.currentRoomId,
            content
          })
        });
        this.messageInput = '';
        await this.loadRoomHistory(this.currentRoomId);
      } catch (error) {
        alert(error.message || '发送失败');
      }
    },
    messageClass(item) {
      if (item.type !== 'message') return 'system-event';
      return item.username === this.currentUser ? 'user-msg' : 'other-msg';
    },
    eventText(event) {
      switch (event.type) {
        case 'join':
          return `${event.username || '用户'} 加入了房间`;
        case 'leave':
          return `${event.username || '用户'} 离开了房间`;
        case 'ready':
          return `${event.username || '用户'} 已准备`;
        case 'unready':
          return `${event.username || '用户'} 取消了准备`;
        case 'game_start':
          return event.content || `${event.username || '房主'} 开始了游戏`;
        case 'online':
          return `${event.username || '用户'} 上线了`;
        default:
          return event.content || event.type || '系统事件';
      }
    },
    formatTime(value) {
      if (!value) return '';
      return new Date(value).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      });
    },
    scrollChatToBottom() {
      nextTick(() => {
        const area = this.$refs.chatArea;
        if (area) {
          area.scrollTop = area.scrollHeight;
        }
      });
    }
  },
  mounted() {
    this.updateViewportState();
    window.addEventListener('resize', this.updateViewportState);
    if (this.authToken && this.currentUser) {
      this.isAuthenticated = true;
      this.connectSocket();
      this.loadRooms();
    }
  },
  beforeUnmount() {
    this.stopRoomAutoRefresh();
    window.removeEventListener('resize', this.updateViewportState);
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}).mount('#app');
