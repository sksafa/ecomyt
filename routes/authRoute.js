import { requireSignIn,isAdmin } from "../middlewares/authMiddleware.js";
import express from "express";
import {
  registerController,
  loginController,
  testController
} from "../controllers/authController.js";


//router object
const router = express.Router();

//routing
//REGISTER || METHOD POST
router.post("/register", registerController);
router.post("/login", loginController);
router.get("/test", requireSignIn, isAdmin, testController);


export default router;