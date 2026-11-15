# Follow T3's access setting

The factory has no access policy or access control in Settings. New owner threads launch with T3's resolved project default runtime mode, since T3's launch RPC requires a concrete mode, and delegated roles pass `inherit`, so T3 narrows and never escalates. T3's own fallback is `full-access`; to restrict factory threads, set a narrower default in T3. Tool approvals are answered in T3; the board only links to them.
