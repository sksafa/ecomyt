import React from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../../context/auth";
import profile from '../../Image/profile.png'
const UserMenu = () => {

  const [auth] = useAuth();

  return (
    <div className="userMenu">
      <div className="profileArea text-center">
        <img src={profile} alt="profile imag" />
        <h4>{auth?.user?.name}</h4>
        <h6>{auth?.user?.email}</h6>
        <h6>{auth?.user?.address}</h6>
      </div>
      <div>
        <div className="ProfileNav">
          <div className="list-group border-0">

            <NavLink to="/dashboard/user" className="list-group-item list-group-item-action" >
              Dashboard
            </NavLink>

            <NavLink to="/dashboard/user/profile" className="list-group-item list-group-item-action" >
              Profile Update
            </NavLink>

            <NavLink to="/dashboard/user/orders" className="list-group-item list-group-item-action" >
              View Orders
            </NavLink>

            <NavLink to="/" className="list-group-item list-group-item-action" >
              Go to Home
            </NavLink>
            
            <NavLink to="/cart" className="list-group-item list-group-item-action" >
              See Cart
            </NavLink>
          </div>

        </div>
      </div>
    </div>
  );
};

export default UserMenu;