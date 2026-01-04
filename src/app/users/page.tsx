'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import TetrisLoading from '@/components/ui/tetris-loader';

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/users');
      
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      
      const data = await response.json();
      setUsers(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching users:', error);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async () => {
    if (!newUserName || !newUserEmail) {
      alert('Please enter both name and email');
      return;
    }

    setCreating(true);
    setError(null);
    
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
        }),
      });

      if (response.ok) {
        const newUser = await response.json();
        setUsers([newUser, ...users]);
        setNewUserName('');
        setNewUserEmail('');
        alert('User created successfully!');
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to create user');
        alert(errorData.error || 'Failed to create user');
      }
    } catch (error) {
      console.error('Error creating user:', error);
      setError('Failed to create user');
      alert('Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <TetrisLoading size="md" speed="normal" loadingText="Loading..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="container mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
          <h1 className="mb-2 text-4xl font-bold text-black dark:text-zinc-50">
            Users
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            Manage system users
          </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}

        {/* Create New User */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-xl font-semibold text-black dark:text-zinc-50">
            Add New User
          </h2>
          <div className="flex flex-col gap-4 md:flex-row">
            <input
              type="text"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              placeholder="Name"
              className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
            <input
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="Email"
              className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
            />
            <button
              onClick={handleCreateUser}
              disabled={creating}
              className="rounded-lg bg-black px-6 py-2 font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
            >
              {creating ? 'Creating...' : 'Add User'}
            </button>
          </div>
        </div>

        {/* Users List */}
        <div className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 p-6 dark:border-zinc-700">
            <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
              All Users ({users.length})
            </h2>
          </div>
          
          {users.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 dark:text-zinc-400">
              No users found. Add your first user above.
            </div>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="p-6 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="mb-1 text-lg font-semibold text-black dark:text-zinc-50">
                        {user.name}
                      </div>
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        {user.email}
                      </div>
                      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                        Created {new Date(user.createdAt).toLocaleDateString()} at{' '}
                        {new Date(user.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="ml-4 rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      Active
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

