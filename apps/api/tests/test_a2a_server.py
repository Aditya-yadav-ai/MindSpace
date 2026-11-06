import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.routing import APIRoute

from mas.a2a.server import A2ATaskRequest, create_a2a_app


class FakeBlackboard:
    def __init__(self, db_path: str | Path = Path("blackboard.db")):
        self.db_path = db_path


class A2ATokenAccountingTests(unittest.TestCase):
    def setUp(self):
        app = create_a2a_app()
        task_route = next(
            route
            for route in app.routes
            if isinstance(route, APIRoute) and route.path == "/tasks"
        )
        self.run_task = task_route.endpoint

    def run_task_with_crew_output(
        self, crew_output, db_path: str | Path = Path("blackboard.db")
    ):
        with (
            patch(
                "mas.blackboard.shared_state.get_blackboard",
                return_value=FakeBlackboard(db_path),
            ),
            patch("mas.monitoring.callbacks.MASCallbackManager") as callback_manager,
            patch("mas.monitoring.observability.get_tracer"),
            patch("mas.monitoring.observability.get_audit_trail"),
            patch(
                "mas.agents.crewai_crew.crew.EcommerceResearchCrew"
            ) as crew_class,
        ):
            crew_class.return_value.run_sequential.return_value = crew_output
            response = self.run_task(
                A2ATaskRequest(
                    input={
                        "query": "market query",
                        "persona": "professional_analyst",
                        "architecture": "sequential",
                        "run_id": "run-1",
                    }
                )
            )
        return response.output, callback_manager

    def test_a2a_does_not_add_token_usage_when_not_reported(self):
        output, _ = self.run_task_with_crew_output({"status": "partial"})

        self.assertNotIn("tokens_used", output)

    def test_a2a_preserves_reported_token_usage(self):
        output, _ = self.run_task_with_crew_output(
            {"status": "partial", "tokens_used": 123}
        )

        self.assertEqual(output["tokens_used"], 123)

    def test_a2a_callback_output_directory_accepts_string_db_path(self):
        database_path = "C:\\MindSpace\\data\\blackboard.db"
        _, callback_manager = self.run_task_with_crew_output(
            {"status": "partial"},
            db_path=database_path,
        )

        callback_manager.assert_called_once_with(
            "run-1",
            str(Path(database_path).parent),
        )


if __name__ == "__main__":
    unittest.main()
