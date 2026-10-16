# IPython startup (copied to the kernel's profile): sets environment variables to match the notebook's
# environment (the local stack's settings, or a deployed one's address and logins), for notebooks that
# read them directly. See export_env in bluecore.py.
try:
    import bluecore as _bluecore

    _bluecore.export_env()
    del _bluecore
except Exception as _err:  # never break a kernel over this
    print("bluecore startup:", _err)
