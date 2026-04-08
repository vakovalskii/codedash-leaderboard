import { useState, useEffect } from 'react';

const AGENT_COLORS = {
  claude: 'bg-orange-500/20 text-orange-400',
  'claude-ext': 'bg-orange-500/20 text-orange-400',
  codex: 'bg-green-500/20 text-green-400',
  cursor: 'bg-blue-500/20 text-blue-400',
  opencode: 'bg-purple-500/20 text-purple-400',
  kiro: 'bg-pink-500/20 text-pink-400',
};

function UserCard({ user, rank }) {
  const [tab] = useState(null); // uses parent tab
  return null; // rendered inline
}

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('today');
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    fetch('/api/leaderboard')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <div className="text-gray-500 text-lg">Loading...</div>
    </div>
  );

  const users = data?.users || [];
  const network = data?.network || {};

  const sorted = [...users].sort((a, b) => {
    if (tab === 'today') return (b.stats?.today?.messages || 0) - (a.stats?.today?.messages || 0);
    if (tab === 'week') return (b.stats?.week?.messages || 0) - (a.stats?.week?.messages || 0);
    return (b.stats?.totals?.messages || 0) - (a.stats?.totals?.messages || 0);
  });

  const getStat = (user) => {
    if (tab === 'today') return user.stats?.today || {};
    if (tab === 'week') return user.stats?.week || {};
    return user.stats?.totals || {};
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <h1 className="text-3xl font-bold text-center mb-2">
          <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">CodeDash</span> Leaderboard
        </h1>
        <p className="text-center text-gray-500 text-sm mb-6">
          Who codes the most with AI? &middot;{' '}
          <a href="https://github.com/vakovalskii/codedash" target="_blank" className="text-blue-400 hover:underline">
            Install CodeDash
          </a>
        </p>

        {/* Network stats */}
        <div className="flex justify-center gap-8 mb-6 p-4 bg-[#161b22] rounded-xl border border-[#30363d]">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-400">{data?.totalUsers || 0}</div>
            <div className="text-xs text-gray-500">on leaderboard</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">{network.totalInstalls || 0}</div>
            <div className="text-xs text-gray-500">vibe coders</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-400">{network.todayActive || 0}</div>
            <div className="text-xs text-gray-500">active today</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-1 mb-4">
          {['today', 'week', 'alltime'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                tab === t
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'border-[#30363d] text-gray-500 hover:border-blue-500 hover:text-[#e6edf3]'
              }`}
            >
              {t === 'alltime' ? 'All Time' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Leaderboard */}
        <div className="space-y-2">
          {sorted.length === 0 && (
            <div className="text-center text-gray-500 py-12">No one yet. Be the first!</div>
          )}
          {sorted.map((user, i) => {
            const stat = getStat(user);
            const msgs = stat.messages || 0;
            const hours = stat.hours || 0;
            const cost = stat.cost || 0;
            const streak = user.stats?.streak || 0;
            const agents = Object.entries(user.stats?.agents || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
            const rankClass = i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-gray-600';

            const shortAgent = (a) => a === 'claude-ext' ? 'cl-ext' : a;

            return (
              <div key={user.username} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 bg-[#161b22] border border-[#30363d] rounded-xl hover:border-blue-500/50 transition-all duration-200 hover:bg-[#1c2129]"
                style={{ animationDelay: `${i * 30}ms` }}>
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className={`text-xl font-bold w-8 text-center shrink-0 ${rankClass}`}>#{i + 1}</div>
                  <img src={user.avatar} alt="" className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-[#30363d] shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">
                      <a href={`https://github.com/${user.username}`} target="_blank" className="hover:text-blue-400 transition-colors">
                        {user.name || user.username}
                      </a>
                      {user.verified && <span className="text-green-400 text-xs ml-1">&#10003;</span>}
                      {user.deviceCount > 1 && <span className="text-[#6e7681] text-[10px] ml-1">{user.deviceCount} dev</span>}
                    </div>
                    <div className="text-gray-500 text-sm">
                      <a href={`https://github.com/${user.username}`} target="_blank" className="hover:text-gray-400">
                        @{user.username}
                      </a>
                    </div>
                    {agents.length > 0 && (
                      <div className="flex gap-1 mt-1 overflow-hidden">
                        {agents.map(([a]) => (
                          <span key={a} className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${AGENT_COLORS[a] || 'bg-gray-500/20 text-gray-400'}`}>
                            {shortAgent(a)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 sm:gap-4 text-sm text-gray-500 flex-wrap sm:justify-end sm:ml-auto pl-11 sm:pl-0">
                  <span><strong className="text-[#e6edf3]">{msgs.toLocaleString()}</strong> <span className="hidden sm:inline">prompts</span><span className="sm:hidden">pr</span></span>
                  <span><strong className="text-[#e6edf3]">{hours.toFixed(1)}h</strong></span>
                  <span><strong className="text-[#e6edf3]">${cost.toFixed(0)}</strong></span>
                  {streak > 1 && (
                    <span className="bg-orange-500/15 text-orange-400 px-2 py-0.5 rounded-full text-xs font-semibold">
                      &#128293; {streak}d
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="text-center mt-8">
          <p className="text-gray-500 text-sm mb-2">Join the leaderboard:</p>
          <code className="bg-[#161b22] px-4 py-2 rounded-lg text-sm border border-[#30363d]">
            npm i -g codedash-app && codedash run
          </code>
        </div>
      </div>
    </div>
  );
}
