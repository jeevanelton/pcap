import { useState, useEffect } from 'react';
import { useAuth, authFetch } from '../contexts/AuthContext';
import { Plus, FolderOpen, Trash2 } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

interface Project {
  id: string;
  name: string;
  created_at: string;
}

export function ProjectSelector({ onSelectProject }: { onSelectProject: (projectId: string) => void }) {
  const { user, logout } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/api/projects`);
      if (!res.ok) throw new Error('Failed to fetch projects');
      const data = await res.json();
      setProjects(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const res = await authFetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName }),
      });
      if (!res.ok) throw new Error('Failed to create project');
      setNewProjectName('');
      setShowNewProject(false);
      await fetchProjects();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!confirm('Delete this project and all its files?')) return;
    try {
      const res = await authFetch(`${API_BASE}/api/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete project');
      await fetchProjects();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-gray-200 p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Your Projects</h1>
              <p className="text-sm text-gray-500 mt-1">Welcome, {user?.email}</p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowNewProject(!showNewProject)}
                className="inline-flex items-center px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl"
              >
                <Plus className="h-5 w-5 mr-2" />
                New Project
              </button>
              <button
                onClick={logout}
                className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-all"
              >
                Logout
              </button>
            </div>
          </div>

          {showNewProject && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Enter project name"
                className="w-full px-4 py-2 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none mb-3"
                onKeyDown={(e) => e.key === 'Enter' && createProject()}
              />
              <div className="flex space-x-2">
                <button
                  onClick={createProject}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowNewProject(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No projects yet. Create one to get started!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="group bg-gradient-to-br from-white to-indigo-50 border border-indigo-200 rounded-xl p-6 hover:shadow-xl transition-all duration-300 cursor-pointer"
                  onClick={() => onSelectProject(project.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <FolderOpen className="h-5 w-5 text-indigo-600" />
                        <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
                      </div>
                      <p className="text-xs text-gray-500">
                        Created {new Date(project.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProject(project.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-red-50 rounded-lg"
                      title="Delete project"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
