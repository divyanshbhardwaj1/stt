"""Web interface: upload a recording, download the finished report.

The FastAPI instance deliberately is not re-exported here. Binding the name
`app` on the package would shadow the `api.app` submodule, so `uvicorn` and the
tests both reach it as `api.app:app`.
"""
